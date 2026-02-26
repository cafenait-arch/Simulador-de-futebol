const App = {
    clubs: [], countries: [], continents: [], competitions: [], competitionStages: [], competitionStageClubs: [],
    competitionStageTransitions: [], competitionStageAwards: [], zipData: null, logoCache: new Map(), flagCache: new Map(), teamTitles: new Map(),
    players: [], playerFicticiousNames: [], playerStats: [], playerYouthReveal: [],
    seasonHistory: [], currentSeason: 0, currentCompetition: null, currentStage: null,
    standings: [], schedule: [], playoffBracket: [], 
    currentGroups: [], currentGroupIndex: 0, currentDivisions: [], currentDivisionIndex: 0,
    clubFormations: new Map(),
    rejectedOffers: [],
    standingsMap: null,
    clubsMap: null,
    playersMap: null, // PERF: O(1) player lookup by id
    countriesMap: null,
    countriesByContinent: null,
    nextSeasonInjections: new Map(),
    // PERF: Pre-processed map: stageId → Set of competitionIds (avoids repeated split/map/includes)
    stageCompetitionIdsMap: null,
    // PERF: Pre-processed map: competitionId → [stage objects]
    competitionStagesMap: null,
    // PERF: Poisson lookup table to avoid repeated Math.exp calls
    _poissonExpCache: new Map(),
    
    // === WEEKLY SIMULATION STATE ===
    seasonState: null,       // State for weekly simulation
    seasonInProgress: false, // Whether a season is currently being simulated week by week
    currentSeasonPreview: null, // Preview data for in-progress season viewing
    TOTAL_WEEKS: 52,         // Minimum weeks in a season (dynamically expanded based on competition needs)
    
YOUTH_LAMBDA_TABLE: {
    1: { rating: 34, potential: 5 },
    2: { rating: 36, potential: 5 },
    3: { rating: 38, potential: 5 },
    4: { rating: 40, potential: 6 },
    5: { rating: 42, potential: 7 },
    6: { rating: 44, potential: 8 },
    7: { rating: 46, potential: 9 },
    8: { rating: 48, potential: 10 },
    9: { rating: 50, potential: 11 },
    10: { rating: 52, potential: 12 },
    11: { rating: 54, potential: 13 },
    12: { rating: 56, potential: 14 },
    13: { rating: 58, potential: 15 },
    14: { rating: 60, potential: 16 },
    15: { rating: 62, potential: 17 },
    16: { rating: 64, potential: 18 },
    17: { rating: 66, potential: 19 },
    18: { rating: 68, potential: 18 },
    19: { rating: 70, potential: 19 },
    20: { rating: 72, potential: 20 }
},
    
formations: {
    '4-3-3': { positions: [1, 3, 4, 4, 2, 5, 8, 8, 6, 7, 9] },
    '4-4-2': { positions: [1, 3, 4, 4, 2, 6, 8, 8, 7, 9, 9] },
    '3-5-2': { positions: [1, 4, 4, 4, 6, 5, 8, 8, 7, 9, 9] },
    '4-2-3-1': { positions: [1, 3, 4, 4, 2, 5, 8, 8, 6, 7, 9] },
    '5-3-2': { positions: [1, 3, 4, 4, 4, 2, 5, 8, 8, 9, 9] },
    '4-1-4-1': { positions: [1, 3, 4, 4, 2, 5, 6, 8, 8, 7, 9] }
},
    
    // Mapeamento de roles
    roleMap: {
        1: { name: 'GOL', category: 'goalkeeper', factor: 0.2 },
        2: { name: 'LD', category: 'defense', factor: 0.6 },
        3: { name: 'LE', category: 'defense', factor: 0.6 },
        4: { name: 'ZG', category: 'defense', factor: 0.4},
        5: { name: 'VL', category: 'midfield', factor: 0.7 },
        6: { name: 'PE', category: 'attack', factor: 0.9 },
        7: { name: 'PD', category: 'attack', factor: 0.9 },
        8: { name: 'MO', category: 'midfield', factor: 0.8 },
        9: { name: 'AT', category: 'attack', factor: 1.3 }
    },

    async loadDB() {
        await this.loadZip("Pack.zip");
        const dataDbFile = Object.values(this.zipData.files).find(f => f.name.toLowerCase().includes("data.db"));
        if (!dataDbFile) throw new Error("Arquivo data.db não encontrado no ZIP");
        const buffer = await dataDbFile.async("arraybuffer");
        const SQL = await initSqlJs({locateFile: () => "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql-wasm.wasm"});
        this.db = new SQL.Database(new Uint8Array(buffer));
        
        const getTable = tableName => this.db.exec(`SELECT * FROM ${tableName}`)[0]?.values || [];
        
        // Carregar Continentes
        try {
            this.continents = getTable("Continent").map(([id, name]) => ({
                id: id != null ? id.toString() : null,
                name
            })).filter(c => c.id != null);
        } catch(e) { this.continents = []; }
        
        this.countries = getTable("Country").map(([id, name, continentId, namesCountryId]) => ({ 
            id: id != null ? id.toString() : null, 
            name,
            continentId: continentId != null ? continentId.toString() : null,
            namesCountryId: namesCountryId != null ? namesCountryId.toString() : null
        })).filter(c => c.id != null);
        
this.competitions = getTable("Competition").map(([id, countryId, name, type, importanceOrder]) => ({
    id: id != null ? id.toString() : null, 
    countryId: countryId != null ? countryId.toString() : null, 
    name, 
    type: +type, 
    importanceOrder: +importanceOrder
})).filter(c => c.id != null);

this.clubs = getTable("Club").map(row => {
    const [id, name, rating, countryId, bTeamOf, transferBalance, youth] = row;
    return {
        id: id != null ? id.toString() : null, 
        name, 
        rating: +rating, 
        countryId: countryId != null ? countryId.toString() : null, 
        originalRating: +rating, 
        bTeamOf: bTeamOf ? bTeamOf.toString() : null,
        transferBalance: transferBalance != null ? +transferBalance : 5000000, // Dinheiro inicial padrão
        youth: youth != null ? Math.min(20, Math.max(1, +youth)) : 10, // Youth 1-20, padrão 10
        competitions: [],
        stages: [],
        originalCompetitions: [],
        originalStages: []
    };
}).filter(c => c.id != null);

// Carregar CompetitionStageAwards
try {
    this.competitionStageAwards = getTable("CompetitionStageAwards").map(([stageId, place, award]) => ({
        stageId: stageId != null ? stageId.toString() : null,
        place: +place,
        award: +award
    })).filter(a => a.stageId != null);
} catch(e) { this.competitionStageAwards = []; }

// Carregar Players
try {
    this.players = getTable("Player").map(([id, name, rating, ratingPotential, clubId, countryId, role, dob]) => ({
        id: id != null ? id.toString() : null,
        name,
        rating: +rating,
        ratingPotential: +ratingPotential,
        clubId: clubId != null ? clubId.toString() : null,
        countryId: countryId != null ? countryId.toString() : null,
        role: +role,
        dob: +dob || 2000, // Ano de nascimento
        retired: false
    })).filter(p => p.id != null);
} catch(e) { this.players = []; }

// Carregar PlayerFicticiousName
try {
    this.playerFicticiousNames = getTable("PlayerFicticiousName").map(([name, firstName, weight, namesCountryId]) => ({
        name,
        firstName: +firstName, // 0 = nome, 1 = sobrenome
        weight: +weight,
        namesCountryId: namesCountryId != null ? namesCountryId.toString() : null
    })).filter(n => n.namesCountryId != null);
} catch(e) { this.playerFicticiousNames = []; }

// Inicializar estatísticas de jogadores
this.playerStats = [];

// Carregar PlayerYouthReveal
try {
    this.playerYouthReveal = getTable("PlayerYouthReveal").map(([countryId, countryPlayerId, probability]) => ({
        countryId: countryId != null ? countryId.toString() : null,
        countryPlayerId: countryPlayerId != null ? countryPlayerId.toString() : null,
        probability: +probability
    })).filter(r => r.countryId != null && r.countryPlayerId != null);
} catch(e) { this.playerYouthReveal = []; }

this.competitionStages = getTable("CompetitionStage").map(([id, competitionId, name, startingWeek, stageType, numLegs, numRounds,numGroups,isWinnerDecisionStage]) => ({
    id: id != null ? id.toString() : null, 
    competitionId: competitionId != null ? competitionId.toString() : null,
    name, 
    startingWeek: +startingWeek,
    stageType: +stageType, 
    numLegs: +numLegs, 
    numRounds: +numRounds, 
    numGroups: +numGroups, 
    isWinnerDecisionStage: +isWinnerDecisionStage
})).filter(s => s.id != null && s.competitionId != null);

this.competitionStageClubs = getTable("CompetitionStageClub").map(([clubId, stageId]) => ({
    clubId: clubId != null ? clubId.toString() : null, 
    stageId: stageId != null ? stageId.toString() : null
})).filter(c => c.clubId != null && c.stageId != null);

this.competitionStageTransitions = getTable("CompetitionStageTransition").map(([stageIdFrom, stageIdTo, place, type]) => ({
    stageIdFrom: stageIdFrom != null ? stageIdFrom.toString() : null, 
    stageIdTo: stageIdTo != null ? stageIdTo.toString() : null, 
    place: +place, 
    type: +type
})).filter(t => t.stageIdFrom != null && t.stageIdTo != null);


        this.clubs.forEach(club => {
            const stageClubs = this.competitionStageClubs.filter(csc => csc.clubId === club.id);
            
            stageClubs.forEach(stageClub => {
                const stage = this.competitionStages.find(s => s.id === stageClub.stageId);
                if (stage) {
                    const competitionIds = stage.competitionId.split(',').map(id => id.trim());
                    competitionIds.forEach(compId => {
                        if (!club.competitions.includes(compId)) {
                            club.competitions.push(compId);
                        }
                    });
                    if (!club.stages.includes(stage.id)) {
                        club.stages.push(stage.id);
                    }
                }
            });
            
            // Stages são atribuídos APENAS pelo CompetitionStageClub
            // A progressão entre stages é feita pelo sistema de transições (CompetitionStageTransition)
            
            club.originalCompetitions = [...club.competitions];
            club.originalStages = [...club.stages];
            // Salvar estado do DB para reset completo entre simulações
            club.dbOriginalCompetitions = [...club.competitions];
            club.dbOriginalStages = [...club.stages];
        });

        this.initializeTitles();
        this.buildCountriesMaps();
    },

    initializeTitles() {
        this.teamTitles = new Map();
        this.clubs.forEach(club => this.teamTitles.set(club.id, { championships: new Map() }));
    },

    async loadZip(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Não foi possível carregar ${url} (status ${response.status})`);
        const buffer = await response.arrayBuffer();
        this.zipData = await JSZip.loadAsync(buffer);
        if (!Object.keys(this.zipData.files).length) throw new Error("O ZIP está vazio");
    },

    async init() {
        await this.loadDB();
        if (!this.db) return;
        this.buildClubsMap();
        this.setupTabs();
        this.populateSelects();
        this.setupEventListeners();
        this.setupSaveLoadListeners();
        document.getElementById("simulateNextSeasonBtn").style.display = 'block';
    },

    setupEventListeners() {
        [
            { id: "simulateBtn", event: "click", fn: () => this.simulate() },
            { id: "simulateNextSeasonBtn", event: "click", fn: () => this.simulateNextSeason() },
            { id: "advanceWeekBtn", event: "click", fn: () => this.advanceWeekUI() },
            { id: "newSeasonBtn", event: "click", fn: () => this.startNewSeasonUI() },
            { id: "viewSeason", event: "change", fn: () => this.viewSeason() },
            { id: "viewCountry", event: "change", fn: () => this.onViewCountryChange() },
            { id: "viewCompetitionType", event: "change", fn: () => this.onViewCompetitionTypeChange() },
            { id: "viewRound", event: "change", fn: () => this.viewRound() },
            { id: "viewCompetition", event: "change", fn: () => this.viewCompetition() },
            { id: "viewStage", event: "change", fn: () => this.viewStage() },
            { id: "groupPrev", event: "click", fn: () => this.changeGroup(-1) },
            { id: "groupNext", event: "click", fn: () => this.changeGroup(1) },
            { id: "divisionUp", event: "click", fn: () => this.changeDivision(-1) },
            { id: "divisionDown", event: "click", fn: () => this.changeDivision(1) },
            { id: "viewPlayoffBtn", event: "click", fn: () => this.togglePlayoffView() },
            { id: "viewTransfersBtn", event: "click", fn: () => this.toggleTransfersView() }
        ].forEach(({ id, event, fn }) => document.getElementById(id)?.addEventListener(event, fn));
    },

    setupTabs() {
        document.querySelectorAll(".nav-item").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".nav-item").forEach(t => t.classList.remove("active"));
                document.querySelectorAll(".tabcontent").forEach(c => {
                    c.style.display = "none";
                    c.classList.remove("active");
                });
                tab.classList.add("active");
                const targetTab = document.getElementById(tab.dataset.tab);
                targetTab.style.display = "block";
                targetTab.classList.add("active");
                
                // Show view section if season tab and results exist
                if (tab.dataset.tab === 'season' && document.getElementById('seasonResults').innerHTML.trim() !== '') {
                    document.getElementById('viewSection').style.display = 'block';
                }
            });
        });
    },

    populateSelects() {
        const populate = (sel, items, valueKey = "id", textKey = "name") => {
            sel.innerHTML = "<option value='' disabled selected>Selecione</option>";
            items.forEach(item => {
                const opt = document.createElement("option");
                opt.value = item[valueKey]; opt.textContent = item[textKey]; sel.appendChild(opt);
            });
        };
        populate(document.getElementById("teamHome"), this.clubs);
        populate(document.getElementById("teamAway"), this.clubs);
    },

    async simulateCompetition(competition, saveToSeason = false, sharedStageResults = new Map(), crossQualified = new Map()) {
        const stages = this.competitionStages.filter(s => {
            const competitionIds = s.competitionId.split(',').map(id => id.trim());
            return competitionIds.includes(competition.id);
        }).sort((a, b) => a.startingWeek - b.startingWeek || Number(a.id) - Number(b.id));
        
        if (stages.length === 0) {
            return null;
        }
        
        const competitionResult = {
            competition,
            stages: [],
            championId: null,
            type: competition.type
        };
        
        let qualifiedTeams = new Map();
        
        for (const stage of stages) {
            let stageResult;
            let teams = [];
            
            if (sharedStageResults.has(stage.id)) {
                // Stage já simulado por outra competição - reutiliza resultado
                // MAS continua processando transições para manter a cadeia de classificação
                stageResult = sharedStageResults.get(stage.id);
                competitionResult.stages.push(stageResult);
                
                // Reconstrói lista de times a partir do resultado cacheado (para place=-1)
                teams = this.getAllTeamsFromStage(stage, stageResult.standings, stageResult.groups, stageResult.playoffBracket)
                    .map(t => this.getClub(t.id)).filter(Boolean);
            } else {
                // Times vêm de: CompetitionStageClub (originalStages) + qualificados de transições + injetados (type 106/100)
                // APENAS times originalmente atribuídos no DB são considerados de club.stages
                // Isso evita "fantasmas" de temporadas anteriores que ficaram em club.stages via transições
                let assignedTeams = this.clubs.filter(club => 
                    club.stages.includes(stage.id) && club.originalStages.includes(stage.id)
                );
                
                const qualifiedFromTransitions = qualifiedTeams.get(stage.id) || [];
                const extraTeams = crossQualified.get(stage.id) || [];
                
                // Combina todas as fontes sem duplicar
                const unique = new Map();
                [...assignedTeams, ...qualifiedFromTransitions, ...extraTeams].forEach(t => { 
                    if (t && !unique.has(t.id)) unique.set(t.id, t); 
                });
                teams = Array.from(unique.values());
                
                if (extraTeams.length) { 
                }
                
                // Fix Supercopa: se o mesmo time venceu campeonato e copa, 
                // substituir o duplicado pelo vice-campeão do campeonato
                if (competition.type === 4 && teams.length < 2 && teams.length > 0) {
                    const sameCountryChampionship = this.competitions.find(c => 
                        c.type === 2 && c.countryId === competition.countryId
                    );
                    if (sameCountryChampionship) {
                        const champStages = this.competitionStages.filter(s => {
                            const compIds = s.competitionId.split(',').map(id => id.trim());
                            return compIds.includes(sameCountryChampionship.id);
                        }).sort((a, b) => b.startingWeek - a.startingWeek);
                        
                        const lastChampStage = champStages.find(s => s.isWinnerDecisionStage) || champStages[0];
                        if (lastChampStage && sharedStageResults.has(lastChampStage.id)) {
                            const champResult = sharedStageResults.get(lastChampStage.id);
                            const secondPlace = champResult.standings?.[1];
                            if (secondPlace) {
                                const secondPlaceClub = this.getClub(secondPlace.id);
                                if (secondPlaceClub && !teams.find(t => t.id === secondPlaceClub.id)) {
                                    teams.push(secondPlaceClub);
                                }
                            }
                        }
                    }
                }
                
                if (teams.length === 0) {
                    continue;
                }
                
                stageResult = await this.simulateStage(stage, teams);
                sharedStageResults.set(stage.id, stageResult);
                competitionResult.stages.push(stageResult);
            }
            
            // SEMPRE processa transições (CompetitionStageTransition) - ÚNICA fonte de verdade
            const transitions = this.competitionStageTransitions.filter(t => t.stageIdFrom === stage.id);
            
            for (const transition of transitions) {
                let teamsToTransfer = [];
                
                if (transition.place === -1) {
                    // place -1 = TODOS os times que participaram do stage
                    teamsToTransfer = teams.map(team => this.getClub(team.id)).filter(Boolean);
                } else {
                    teamsToTransfer = this.getTeamsByPosition(stage, transition.place, stageResult.standings, stageResult.groups, stageResult.playoffBracket)
                        .map(team => this.getClub(team.id)).filter(Boolean);
                }
                
                if (teamsToTransfer.length > 0) {
                    if (!qualifiedTeams.has(transition.stageIdTo)) {
                        qualifiedTeams.set(transition.stageIdTo, []);
                    }
                    const currentTeams = qualifiedTeams.get(transition.stageIdTo);
                    teamsToTransfer.forEach(team => {
                        if (!currentTeams.find(t => t.id === team.id)) {
                            currentTeams.push(team);
                        }
                    });
                    
                    // Type 106: adiciona ao mapa global para injetar em outra competição no mesmo ano
                    if (transition.type === 106) {
                        const targetStage = this.competitionStages.find(s => s.id === transition.stageIdTo);
                        if (targetStage) {
                            const targetCompIds = targetStage.competitionId.split(',').map(id => id.trim());
                            const isDifferentCompetition = !targetCompIds.includes(competition.id);
                            
                            if (isDifferentCompetition) {
                                if (!crossQualified.has(transition.stageIdTo)) {
                                    crossQualified.set(transition.stageIdTo, []);
                                }
                                const globalList = crossQualified.get(transition.stageIdTo);
                                teamsToTransfer.forEach(team => {
                                    if (!globalList.find(t => t.id === team.id)) {
                                        globalList.push(team);
                                    }
                                });
                            }
                        }
                    }
                }
            }
            
            if (stage.isWinnerDecisionStage) {
                if (stage.stageType === 0 || stage.stageType === 2 || stage.stageType === 3) {
                    competitionResult.championId = stageResult.standings?.[0]?.id || null;
                } else if (stage.stageType === 1 && stageResult.playoffBracket) {
                    const finalRound = stageResult.playoffBracket[stageResult.playoffBracket.length - 1];
if (finalRound && finalRound.matches && finalRound.matches.length > 0) {



                        const winner = finalRound.matches[0].winner;
                        if (winner) {
                            competitionResult.championId = winner.id;
                        }
                    }
                }
            }
        }
        
        if (saveToSeason && competitionResult.championId) {
            this.addChampionship(competitionResult.championId, competition.id);
        }
        
        return saveToSeason ? competitionResult : null;
    },

    async simulateStage(stage, teams) {
        const stageResult = {
            stage,
            standings: [],
            schedule: [],
            playoffBracket: [],
            groups: [],
            clubsStats: []
        };
        
        stageResult.clubsStats = teams.map(team => ({
            id: team.id,
            currentRating: team.rating,
            expectedGoalsFor: 0,
            expectedGoalsAgainst: 0,
            actualGoalsFor: 0,
            actualGoalsAgainst: 0,
            goals: 0,
            assists: 0,
            cleanSheets: 0
        }));
        
        // Criar Map para acesso O(1) ao invés de find O(n)
        const clubsStatsMap = new Map(stageResult.clubsStats.map(s => [s.id, s]));
        
// Dentro de simulateStage, após criar o stageResult

if (stage.stageType === 1) {
    // Playoff - já tem registro dentro de simulatePlayoff
    const playoffData = this.simulatePlayoff(teams, stage);
    stageResult.playoffBracket = playoffData.bracket;
    stageResult.playoffData = playoffData;
    stageResult.standings = this.getPlayoffTeamsInOrder(playoffData.bracket, playoffData.winners);
}
else if (stage.stageType === 2) {
    // Liga com potes
    stageResult.schedule = this.generatePotLeagueSchedule(teams);
    this.initializeStandings(teams);
    
    for (const roundMatches of stageResult.schedule) {
        for (const match of roundMatches) {
            // O playMatch já registra jogos e gols internamente
            this.playMatch(match, stageResult.clubsStats, clubsStatsMap);
        }
    }
    
    this.sortStandings();
    stageResult.standings = JSON.parse(JSON.stringify(this.standings));
}
else if (stage.stageType === 3) {
    // Grupos onde times jogam contra todos os times dos OUTROS grupos
    stageResult.groups = this.simulateCrossGroupStage(teams, stage, stageResult.clubsStats, clubsStatsMap);
    stageResult.standings = this.consolidateGroupStandings(stageResult.groups);
}
else if (stage.numGroups > 1) {
    stageResult.groups = this.simulateGroupStage(teams, stage, stageResult.clubsStats, clubsStatsMap);
    stageResult.standings = this.consolidateGroupStandings(stageResult.groups);
}
else {
    stageResult.schedule = this.generateLeagueSchedule(teams, stage.numRounds || 2);
    this.initializeStandings(teams);
    
    for (const roundMatches of stageResult.schedule) {
        for (const match of roundMatches) {
            this.playMatch(match, stageResult.clubsStats, clubsStatsMap);
        }
    }
    
    this.sortStandings();
    stageResult.standings = JSON.parse(JSON.stringify(this.standings));
}
        
        this.updateRatingsFromStats(stageResult.clubsStats);
        return stageResult;
    },

    getPlayoffTeamsInOrder(playoffBracket, winners = []) {
        // Com a nova estrutura, apenas cria standings básicos
        // Winners = vencedores que avançam
        // Losers = perdedores que são eliminados
        const standings = [];
        
        if (playoffBracket.length > 0 && playoffBracket[0].matches) {
            playoffBracket[0].matches.forEach(match => {
                // Adiciona o vencedor
                standings.push({
                    id: match.winner.id,
                    name: match.winner.name,
                    played: 1, won: 1, drawn: 0, lost: 0,
                    goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 3,
                    playoffRound: 1,
                    qualified: true
                });
                
                // Adiciona o perdedor
                const loser = match.winner.id === match.team1.id ? match.team2 : match.team1;
                standings.push({
                    id: loser.id,
                    name: loser.name,
                    played: 1, won: 0, drawn: 0, lost: 1,
                    goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
                    playoffRound: 1,
                    qualified: false
                });
            });
        }
        
        return standings.sort((a, b) => {
            if (a.qualified && !b.qualified) return -1;
            if (!a.qualified && b.qualified) return 1;
            return b.points - a.points;
        });
    },

    findNextPlayoffStage(currentStage, competition) {
        // Encontra o PRÓXIMO stage de playoff (stageType=1) dentro da mesma competição
        // Usa startingWeek para ordenar (IDs são strings, comparação léxica falha)
        const competitionIds = competition.id.split(',').map(id => id.trim());
        
        const candidates = this.competitionStages.filter(stage => {
            if (stage.stageType !== 1) return false;
            if (stage.id === currentStage.id) return false;
            // Usar startingWeek para ordenação (numérico, confiável)
            if (stage.startingWeek < currentStage.startingWeek) return false;
            // Se mesmo startingWeek, usar ID numérico como desempate
            if (stage.startingWeek === currentStage.startingWeek && Number(stage.id) <= Number(currentStage.id)) return false;
            
            const stageCompIds = stage.competitionId.split(',').map(id => id.trim());
            return stageCompIds.some(id => competitionIds.includes(id));
        });
        
        if (candidates.length === 0) return null;
        
        // Retorna o mais próximo (menor startingWeek, ou menor ID como desempate)
        return candidates.sort((a, b) => {
            if (a.startingWeek !== b.startingWeek) return a.startingWeek - b.startingWeek;
            return Number(a.id) - Number(b.id);
        })[0];
    },

    getAllTeamsFromPlayoff(playoffBracket) {
        const teams = new Map();
        playoffBracket.forEach(round => {
            round.matches.forEach(match => {
                if (match.team1.id) teams.set(match.team1.id, match.team1);
                if (match.team2.id) teams.set(match.team2.id, match.team2);
            });
        });
        return Array.from(teams.values());
    },

    simulateGroupStage(teams, stage, clubsStats = [], clubsStatsMap = null) {
        const groups = [];
        const numGroups = stage.numGroups || 1;
        const numRounds = stage.numRounds || 2;
        
        const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
        
        // Distribuir times uniformemente, incluindo sobras nos primeiros grupos
        const baseSize = Math.floor(shuffledTeams.length / numGroups);
        const remainder = shuffledTeams.length % numGroups;
        let startIndex = 0;
        
        for (let g = 0; g < numGroups; g++) {
            const groupSize = baseSize + (g < remainder ? 1 : 0);
            const groupTeams = shuffledTeams.slice(startIndex, startIndex + groupSize);
            startIndex += groupSize;
            const groupId = String.fromCharCode(65 + g);
            
            if (groupTeams.length < 2) continue;
            
            const group = {
                id: groupId,
                teams: groupTeams,
                standings: [],
                schedule: this.generateLeagueSchedule(groupTeams, numRounds)
            };
            
            this.initializeStandings(groupTeams);
            
            for (const roundMatches of group.schedule) {
                for (const match of roundMatches) {
                    this.playMatch(match, clubsStats, clubsStatsMap);
                }
            }
            
            this.sortStandings();
            group.standings = JSON.parse(JSON.stringify(this.standings));
            groups.push(group);
        }
        
        return groups;
    },

simulateCrossGroupStage(teams, stage, clubsStats = [], clubsStatsMap = null) {
    const numGroups = stage.numGroups ?? 2;
    
    /* ========= SHUFFLE ========= */
    const shuffled = [...teams];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    /* ========= GRUPOS ========= */
    const groups = Array.from({ length: numGroups }, (_, i) => ({
        id: String.fromCharCode(65 + i),
        teams: []
    }));
    
    shuffled.forEach((t, i) => groups[i % numGroups].teams.push(t));
    
    const teamGroup = new Map();
    groups.forEach(g =>
        g.teams.forEach(t => teamGroup.set(t.id, g.id))
    );
    
    /* ========= SCHEDULE ========= */
    const schedule = [];
    let globalRound = 1;
    
    for (let g1 = 0; g1 < groups.length; g1++) {
        for (let g2 = g1 + 1; g2 < groups.length; g2++) {
            
            let A = groups[g1].teams.map(t => t.id);
            let B = groups[g2].teams.map(t => t.id);
            
            // Completa com BYE
            const maxLen = Math.max(A.length, B.length);
            while (A.length < maxLen) A.push(null);
            while (B.length < maxLen) B.push(null);
            
            let rotA = [...A];
            let rotB = [...B];
            
            for (let r = 0; r < maxLen; r++) {
                const roundMatches = [];
                const invertHome = r % 2 === 1;
                
                for (let i = 0; i < maxLen; i++) {
                    const a = rotA[i];
                    const b = rotB[i];
                    if (!a || !b) continue;
                    
                    const home = invertHome ? b : a;
                    const away = invertHome ? a : b;
                    
                    roundMatches.push({
                        home,
                        away,
                        homeScore: 0,
                        awayScore: 0,
                        played: false,
                        round: globalRound,
                        homeGroup: teamGroup.get(home),
                        awayGroup: teamGroup.get(away)
                    });
                }
                
                schedule.push(roundMatches);
                globalRound++;
                
                // Rotação tipo círculo
                rotA = [rotA[0], ...rotA.slice(2), rotA[1]];
                rotB = [rotB[rotB.length - 1], ...rotB.slice(0, rotB.length - 1)];
            }
        }
    }
    
    /* ========= SIMULA ========= */
    this.initializeStandings(teams);
    schedule.forEach(r =>
        r.forEach(m => this.playMatch(m, clubsStats, clubsStatsMap))
    );
    this.sortStandings();
    
    const finalStandings = structuredClone(this.standings);
    
    /* ========= RETORNO ========= */
    return groups.map(g => ({
        id: g.id,
        teams: g.teams,
        standings: finalStandings.filter(s =>
            g.teams.some(t => t.id === s.id)
        ),
        schedule: schedule.map(r =>
            r.filter(m =>
                g.teams.some(t => t.id === m.home || t.id === m.away)
            )
        ),
        isCrossGroup: true
    }));
},

    simulatePlayoff(teams, stage) {
        const numLegs = stage.numLegs || 1;
        const bracket = [];
        
        let allTeams = teams
            .filter(team => team && team.id)
            .map(team => ({ ...team }));

        if (allTeams.length < 2) {
            return { bracket: [], championId: null, winners: [] };
        }

        // Simula apenas UMA rodada de confrontos
        const round = { number: 1, matches: [], isPreliminary: false };
        const winners = [];
        
        // Emparelha times de forma aleatória
        const shuffledTeams = [...allTeams].sort(() => Math.random() - 0.5);
        
        // Se número ímpar, descarta o último (sem BYE)
        if (shuffledTeams.length % 2 !== 0) {
            shuffledTeams.pop();
        }
        
        for (let i = 0; i < shuffledTeams.length; i += 2) {
            
            const team1 = shuffledTeams[i];
            const team2 = shuffledTeams[i + 1];
            
            if (!team1 || !team2 || !team1.id || !team2.id) {
                continue;
            }
            
            const club1 = this.getClub(team1.id);
            const club2 = this.getClub(team2.id);
            
            if (!club1 || !club2) {
                continue;
            }
            
            let aggregateHome = 0;
            let aggregateAway = 0;
            let allHomeScorers = [];
            let allAwayScorers = [];
            let homeLineup1 = [], awayLineup1 = [], homeLineup2 = [], awayLineup2 = [];
            let homeFormation1 = '', awayFormation1 = '', homeFormation2 = '', awayFormation2 = '';
            
            // === JOGO 1: club1 em casa ===
            const homeLineupData1 = this.selectLineup(club1.id);
            const awayLineupData1 = this.selectLineup(club2.id);
            homeLineup1 = homeLineupData1.lineup;
            awayLineup1 = awayLineupData1.lineup;
            homeFormation1 = homeLineupData1.formation;
            awayFormation1 = awayLineupData1.formation;
            
            // Registrar jogos para cada jogador
            homeLineup1.forEach(p => this.addPlayerGame(p.id));
            awayLineup1.forEach(p => this.addPlayerGame(p.id));
            
            // Calcular stats do time baseado nos jogadores escalados
            const homeStats1 = this.calculateTeamStats(club1.id, homeLineup1);
            const awayStats1 = this.calculateTeamStats(club2.id, awayLineup1);
            
            const homeExpected1 = this.calcExpectedGoalsNew(homeStats1, awayStats1, true);
            const awayExpected1 = this.calcExpectedGoalsNew(awayStats1, homeStats1, false);
            const homeScore1 = this.poisson(homeExpected1);
            const awayScore1 = this.poisson(awayExpected1);
            
            // Simular quem marcou os gols
            const homeScorers1 = this.simulateGoalScorers(homeLineup1, homeScore1);
            const awayScorers1 = this.simulateGoalScorers(awayLineup1, awayScore1);
            allHomeScorers.push(...homeScorers1);
            allAwayScorers.push(...awayScorers1);
            
            aggregateHome += homeScore1;
            aggregateAway += awayScore1;
            
            let homeScore2 = 0;
            let awayScore2 = 0;
            
            // === JOGO 2 (se numLegs > 1): club2 em casa ===
            if (numLegs > 1) {
                const homeLineupData2 = this.selectLineup(club2.id);
                const awayLineupData2 = this.selectLineup(club1.id);
                homeLineup2 = homeLineupData2.lineup;
                awayLineup2 = awayLineupData2.lineup;
                homeFormation2 = homeLineupData2.formation;
                awayFormation2 = awayLineupData2.formation;
                
                // Registrar jogos
                homeLineup2.forEach(p => this.addPlayerGame(p.id));
                awayLineup2.forEach(p => this.addPlayerGame(p.id));
                
                const homeStats2 = this.calculateTeamStats(club2.id, homeLineup2);
                const awayStats2 = this.calculateTeamStats(club1.id, awayLineup2);
                
                const homeExpected2 = this.calcExpectedGoalsNew(homeStats2, awayStats2, true);
                const awayExpected2 = this.calcExpectedGoalsNew(awayStats2, homeStats2, false);
                homeScore2 = this.poisson(homeExpected2);
                awayScore2 = this.poisson(awayExpected2);
                
                // Simular gols do jogo 2
                const homeScorers2 = this.simulateGoalScorers(homeLineup2, homeScore2);
                const awayScorers2 = this.simulateGoalScorers(awayLineup2, awayScore2);
                allAwayScorers.push(...homeScorers2); // club2 marcando em casa = gols do away no agregado
                allHomeScorers.push(...awayScorers2); // club1 marcando fora = gols do home no agregado
                
                aggregateHome += awayScore2; // club1 marcou fora
                aggregateAway += homeScore2; // club2 marcou em casa
            }
            
            let winner;
            if (aggregateHome > aggregateAway) {
                winner = team1;
            } else if (aggregateAway > aggregateHome) {
                winner = team2;
            } else {
                winner = Math.random() > 0.5 ? team1 : team2;
            }
            
            round.matches.push({
                team1, team2, 
                homeScore: homeScore1,
                awayScore: awayScore1,
                homeScore2: homeScore2,
                awayScore2: awayScore2,
                aggregateHome,
                aggregateAway,
                winner,
                isBye: false, 
                isPenalty: aggregateHome === aggregateAway,
                numLegs: numLegs,
                homeLineup: homeLineup1.map(p => ({ id: p.id, name: p.name, role: p.role })),
                awayLineup: awayLineup1.map(p => ({ id: p.id, name: p.name, role: p.role })),
                homeFormation: homeFormation1,
                awayFormation: awayFormation1,
                homeScorers: allHomeScorers.map(p => ({ id: p.id, name: p.name })),
                awayScorers: allAwayScorers.map(p => ({ id: p.id, name: p.name }))
            });
            winners.push(winner);
        }
        
        bracket.push(round);
        
        return { 
            bracket, 
            championId: winners.length === 1 ? winners[0].id : null,
            winners
        };
    },

    // Versão antiga do simulatePlayoff que gerava todas as fases (não usado mais)
    async simulatePlayoffOld(teams, stage) {
        // Código antigo removido - agora cada fase de playoff é um CompetitionStage separado
    },

    getTeamsByPosition(stage, position, standings, groups, playoffBracket) {
        if (playoffBracket && playoffBracket.length > 0) {
            if (position === -1) {
                // Retorna todos os times
                const allTeams = new Map();
                playoffBracket.forEach(round => {
                    round.matches.forEach(match => {
                        if (match.team1.id) allTeams.set(match.team1.id, match.team1);
                        if (match.team2.id) allTeams.set(match.team2.id, match.team2);
                    });
                });
                return Array.from(allTeams.values());
            }
            
            const qualified = [];
            
            // Em cada fase de playoff (rodada única por stage):
            // Position 1 = vencedores (avançam para próxima fase)
            // Position 2 = perdedores (eliminados ou vão para outra transição)
            if (position === 1) {
                // Retorna todos os vencedores desta fase
                playoffBracket.forEach(round => {
                    round.matches.forEach(match => {
                        if (match.winner && !qualified.find(q => q.id === match.winner.id)) {
                            qualified.push(match.winner);
                        }
                    });
                });
            }
            else if (position === 2) {
                // Retorna todos os perdedores desta fase
                playoffBracket.forEach(round => {
                    round.matches.forEach(match => {
                        if (match.winner) {
                            const loser = match.winner.id === match.team1.id ? match.team2 : match.team1;
                            if (loser && loser.id && !qualified.find(q => q.id === loser.id)) {
                                qualified.push(loser);
                            }
                        }
                    });
                });
            }
            // Para position > 2, não há mais classificações em playoff (apenas 1º e 2º)
            
            return qualified;
        }
        else if (groups && groups.length > 0) {
            const qualified = [];
            groups.forEach(group => {
                if (position <= group.standings.length) {
                    qualified.push(group.standings[position - 1]);
                }
            });
            return qualified;
        } else if (standings && standings.length > 0) {
            if (position <= standings.length) {
                return [standings[position - 1]];
            }
        }
        return [];
    },

    getAllTeamsFromStage(stage, standings, groups, playoffBracket) {
        if (playoffBracket && playoffBracket.length > 0) {
            const allTeams = new Map();
            playoffBracket.forEach(round => {
                round.matches.forEach(match => {
                    if (match.team1.id) allTeams.set(match.team1.id, match.team1);
                    if (match.team2.id) allTeams.set(match.team2.id, match.team2);
                });
            });
            return Array.from(allTeams.values());
        }
        else if (groups && groups.length > 0) {
            const allTeams = [];
            groups.forEach(group => {
                group.standings.forEach(team => {
                    allTeams.push(team);
                });
            });
            return allTeams;
        } else if (standings && standings.length > 0) {
            return standings;
        }
        return [];
    },

    consolidateGroupStandings(groups) {
        const allStandings = [];
        groups.forEach(group => {
            group.standings.forEach((team, index) => {
                allStandings.push({
                    ...team,
                    group: group.id,
                    positionInGroup: index + 1
                });
            });
        });
        
        return allStandings.sort((a, b) => 
            b.points - a.points || 
            b.goalDifference - a.goalDifference || 
            b.goalsFor - a.goalsFor
        );
    },

    playMatch(match, clubsStats, clubsStatsMap) {
        const homeClub = this.getClub(match.home);
        const awayClub = this.getClub(match.away);
        if (!homeClub || !awayClub) return;
        
        // Novo sistema: escalar jogadores
        const homeLineupData = this.selectLineup(homeClub.id);
        const awayLineupData = this.selectLineup(awayClub.id);
        
        const homeLineup = homeLineupData.lineup;
        const awayLineup = awayLineupData.lineup;
        
        // Registrar jogos para cada jogador
        homeLineup.forEach(p => this.addPlayerGame(p.id));
        awayLineup.forEach(p => this.addPlayerGame(p.id));
        
        // Calcular stats do time baseado nos jogadores escalados
        const homeStats = this.calculateTeamStats(homeClub.id, homeLineup);
        const awayStats = this.calculateTeamStats(awayClub.id, awayLineup);
        
        // Novo calcExpectedGoals usando ataque+meio vs defesa+goleiro
        const homeExpected = this.calcExpectedGoalsNew(homeStats, awayStats, true);
        const awayExpected = this.calcExpectedGoalsNew(awayStats, homeStats, false);
        
        const homeScore = this.poisson(homeExpected);
        const awayScore = this.poisson(awayExpected);
        
        // Simular quem marcou os gols
        const homeScorers = this.simulateGoalScorers(homeLineup, homeScore);
        const awayScorers = this.simulateGoalScorers(awayLineup, awayScore);
        
        Object.assign(match, { 
            homeScore, 
            awayScore, 
            played: true,
            homeLineup: homeLineup.map(p => ({ id: p.id, name: p.name, role: p.role })),
            awayLineup: awayLineup.map(p => ({ id: p.id, name: p.name, role: p.role })),
            homeFormation: homeLineupData.formation,
            awayFormation: awayLineupData.formation,
            homeScorers: homeScorers.map(p => ({ id: p.id, name: p.name })),
            awayScorers: awayScorers.map(p => ({ id: p.id, name: p.name }))
        });
        
        this.updateStandings(homeClub.id, awayClub.id, homeScore, awayScore, homeExpected, awayExpected);
        
        // Usar Map para acesso O(1) ao invés de find O(n)
        const homeClubStats = clubsStatsMap ? clubsStatsMap.get(match.home) : clubsStats.find(s => s.id === match.home);
        const awayClubStats = clubsStatsMap ? clubsStatsMap.get(match.away) : clubsStats.find(s => s.id === match.away);
        if (homeClubStats) {
            homeClubStats.expectedGoalsFor += homeExpected;
            homeClubStats.expectedGoalsAgainst += awayExpected;
            homeClubStats.actualGoalsFor += homeScore;
            homeClubStats.actualGoalsAgainst += awayScore;
            if (awayScore === 0) homeClubStats.cleanSheets++;
        }
        if (awayClubStats) {
            awayClubStats.expectedGoalsFor += awayExpected;
            awayClubStats.expectedGoalsAgainst += homeExpected;
            awayClubStats.actualGoalsFor += awayScore;
            awayClubStats.actualGoalsAgainst += homeScore;
            if (homeScore === 0) awayClubStats.cleanSheets++;
        }
    },

generatePotLeagueSchedule(teams) {
    const NUM_POTS = 4;
    const TEAMS_PER_POT = 9;
    const OPP_PER_POT = 2;
    const TOTAL_HOME = 4;
    
    // === Ordena e cria potes ===
    const sorted = [...teams].sort((a, b) => b.rating - a.rating);
    const pots = Array.from({ length: NUM_POTS }, (_, i) =>
        sorted.slice(i * TEAMS_PER_POT, (i + 1) * TEAMS_PER_POT).map(t => t.id)
    );
    
    // === Estado dos times ===
    const state = new Map();
    teams.forEach(t => {
        state.set(t.id, {
            home: 0,
            away: 0,
            potCount: Array(NUM_POTS).fill(0)
        });
    });
    
    const matches = [];
    
    // === Fisher-Yates ===
    const shuffle = arr => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };
    
    // === GERA CONFRONTOS POR POTE ===
    for (let p1 = 0; p1 < NUM_POTS; p1++) {
        for (let p2 = p1 + 1; p2 < NUM_POTS; p2++) {
            
            const a = shuffle([...pots[p1]]);
            const b = shuffle([...pots[p2]]);
            
            // Cada time enfrenta 2 do outro pote
            for (let i = 0; i < a.length; i++) {
                for (let k = 0; k < OPP_PER_POT; k++) {
                    const teamA = a[i];
                    const teamB = b[(i * OPP_PER_POT + k) % b.length];
                    
                    const sA = state.get(teamA);
                    const sB = state.get(teamB);
                    
                    if (sA.potCount[p2] >= OPP_PER_POT ||
                        sB.potCount[p1] >= OPP_PER_POT) {
                        continue;
                    }
                    
                    // Decide mando (balanceado)
                    const home =
                        sA.home < TOTAL_HOME &&
                        (sB.away >= TOTAL_HOME || Math.random() < 0.5) ?
                        teamA :
                        teamB;
                    
                    const away = home === teamA ? teamB : teamA;
                    
                    state.get(home).home++;
                    state.get(away).away++;
                    sA.potCount[p2]++;
                    sB.potCount[p1]++;
                    
                    matches.push({
                        home,
                        away,
                        homeScore: 0,
                        awayScore: 0,
                        played: false,
                        round: null
                    });
                }
            }
        }
    }
    
    // === AGENDAMENTO DE RODADAS ===
    const schedule = [];
    const remaining = [...matches];
    let round = 1;
    
    while (remaining.length) {
        const used = new Set();
        const roundGames = [];
        
        for (let i = remaining.length - 1; i >= 0; i--) {
            const m = remaining[i];
            if (!used.has(m.home) && !used.has(m.away)) {
                m.round = round;
                roundGames.push(m);
                used.add(m.home);
                used.add(m.away);
                remaining.splice(i, 1);
            }
        }
        
        schedule.push(roundGames);
        round++;
    }
    
    return schedule;
},

generateLeagueSchedule(teams, numRounds = 1) {
    const ids = teams.map(t => t.id);
    
    if (ids.length % 2 !== 0) ids.push(null); // BYE
    const n = ids.length;
    const roundsPerTurn = n - 1;
    const matchesPerRound = n / 2;
    
    let rotation = [...ids];
    const schedule = [];
    let roundNumber = 1;
    
    for (let turn = 0; turn < numRounds; turn++) {
        for (let r = 0; r < roundsPerTurn; r++) {
            const round = [];
            
            for (let i = 0; i < matchesPerRound; i++) {
                const a = rotation[i];
                const b = rotation[n - 1 - i];
                if (!a || !b) continue;
                
                const isEven = (r + turn) % 2 === 0;
                round.push({
                    home: isEven ? a : b,
                    away: isEven ? b : a,
                    homeScore: 0,
                    awayScore: 0,
                    played: false,
                    round: roundNumber
                });
            }
            
            schedule.push(round);
            roundNumber++;
            
            // Rotação clássica do círculo
            rotation = [
                rotation[0],
                ...rotation.slice(2),
                rotation[1]
            ];
        }
        
        // Inverte mando no returno
        schedule.slice(-roundsPerTurn).forEach(round =>
            round.forEach(m => {
                [m.home, m.away] = [m.away, m.home];
            })
        );
    }
    
    return schedule;
},

// Removido sistema de atualização de rating dos times - agora baseado em jogadores
updateRatingsFromStats(clubsStats) {
    // Sistema removido conforme solicitado
    // O rating dos times será calculado com base nos jogadores escalados
},

// Calcular rating do time baseado nos jogadores escalados
calculateTeamRating(clubId, lineup) {
    if (!lineup || lineup.length === 0) {
        const club = this.getClub(clubId);
        return club ? club.rating : 50;
    }
    
    let totalRating = 0;
    lineup.forEach(player => {
        let rating = player.rating;
        // Penalidade de -10 se jogador está fora de posição (não afeta stats permanentes)
        if (player.positionMismatch) {
            rating -= 10;
        }
        totalRating += rating;
    });
    
    return totalRating / lineup.length;
},

// Calcular ataque/defesa do time
// Usa lineupRole (posição na escalação) para categorizar, não o role original do jogador
calculateTeamStats(clubId, lineup) {
    const defaultStats = { attack: 50, defense: 50, midfield: 50, goalkeeper: 50 };
    if (!lineup || lineup.length === 0) return defaultStats;
    
    const stats = { attack: [], defense: [], midfield: [], goalkeeper: [] };
    
    lineup.forEach(player => {
        // Usar lineupRole (posição na escalação) para categorizar corretamente
        const roleInfo = this.roleMap[player.lineupRole];
        if (roleInfo) {
            let rating = player.rating;
            // Penalidade de -10 se jogador está fora de posição (não afeta stats permanentes)
            if (player.positionMismatch) rating -= 10;
            stats[roleInfo.category].push(rating);
        }
    });
    
    return {
        attack: stats.attack.length > 0 ? stats.attack.reduce((a,b) => a+b, 0) / stats.attack.length : 50,
        defense: stats.defense.length > 0 ? stats.defense.reduce((a,b) => a+b, 0) / stats.defense.length : 50,
        midfield: stats.midfield.length > 0 ? stats.midfield.reduce((a,b) => a+b, 0) / stats.midfield.length : 50,
        goalkeeper: stats.goalkeeper.length > 0 ? stats.goalkeeper[0] : 50
    };
},

// Novo calcExpectedGoals baseado em ataque/meio e defesa/goleiro
calcExpectedGoalsNew(teamStats, oppStats, isHome = false) {
    const HOME_ATK = 1;
    const HOME_DEF = 2;
    
const atk =
    (teamStats.attack * 0.7 + teamStats.midfield * 0.3) +
    (isHome ? HOME_ATK : 0);
    
    const def =
        (oppStats.defense + oppStats.goalkeeper) / 2 +
        (isHome ? HOME_DEF : 0);
    
    const diff = atk - def;
    
    return Math.max(
        1.1 + 0.05 * Math.sign(diff) * (Math.abs(diff) ** 1.2),
        0.01
    );
},

// Atribuir formação fixa a um time (se ainda não tem)
assignClubFormation(clubId) {
    if (!this.clubFormations.has(clubId)) {
        const formationKeys = Object.keys(this.formations);
        const randomFormation = formationKeys[Math.floor(Math.random() * formationKeys.length)];
        this.clubFormations.set(clubId, randomFormation);
    }
    return this.clubFormations.get(clubId);
},

// Obter formação fixa do time
getClubFormation(clubId) {
    return this.clubFormations.get(clubId) || this.assignClubFormation(clubId);
},

// Calcular média de ataque e defesa baseada na formação e jogadores
// Calcular média de ataque, meio-campo e defesa baseada na formação e jogadores
calculateFormationAverages(clubId) {
    const clubPlayers = this.players.filter(p => p.clubId === clubId && !p.retired);
    const formationKey = this.getClubFormation(clubId);
    const formation = this.formations[formationKey];
    
    if (!formation || clubPlayers.length === 0) {
        return { attack: 0, midfield: 0, defense: 0, formation: formationKey };
    }
    
    // Simula a escalação para obter médias
    const lineup = [];
    const usedPlayers = new Set();
    
    formation.positions.forEach((requiredRole) => {
        let bestPlayer = null;
        let bestRating = -1;
        
        clubPlayers.forEach(player => {
            if (usedPlayers.has(player.id)) return;
            if (player.role === requiredRole && player.rating > bestRating) {
                bestPlayer = player;
                bestRating = player.rating;
            }
        });
        
        if (!bestPlayer) {
            clubPlayers.forEach(player => {
                if (usedPlayers.has(player.id)) return;
                if (player.rating > bestRating) {
                    bestPlayer = player;
                    bestRating = player.rating;
                }
            });
        }
        
        if (bestPlayer) {
            usedPlayers.add(bestPlayer.id);
            lineup.push({ ...bestPlayer, lineupRole: requiredRole });
        }
    });
    
    // Calcular médias por categoria
    const attackPlayers = lineup.filter(p => {
        const roleInfo = this.roleMap[p.lineupRole];
        return roleInfo && roleInfo.category === 'attack';
    });
    
    const midfieldPlayers = lineup.filter(p => {
        const roleInfo = this.roleMap[p.lineupRole];
        return roleInfo && roleInfo.category === 'midfield';
    });
    
    const defensePlayers = lineup.filter(p => {
        const roleInfo = this.roleMap[p.lineupRole];
        return roleInfo && (roleInfo.category === 'defense' || roleInfo.category === 'goalkeeper');
    });
    
    const attackAvg = attackPlayers.length > 0 ?
        attackPlayers.reduce((sum, p) => sum + p.rating, 0) / attackPlayers.length :
        50;
    
    const midfieldAvg = midfieldPlayers.length > 0 ?
        midfieldPlayers.reduce((sum, p) => sum + p.rating, 0) / midfieldPlayers.length :
        50;
    
    const defenseAvg = defensePlayers.length > 0 ?
        defensePlayers.reduce((sum, p) => sum + p.rating, 0) / defensePlayers.length :
        50;
    
    return {
        attack: Math.round(attackAvg * 10) / 10,
        midfield: Math.round(midfieldAvg * 10) / 10,
        defense: Math.round(defenseAvg * 10) / 10,
        formation: formationKey
    };
},

// Cache de jogadores por clube
playersByClubCache: null,

buildPlayersByClubCache() {
    this.playersByClubCache = new Map();
    this.players.forEach(p => {
        if (p.retired) return;
        if (!this.playersByClubCache.has(p.clubId)) {
            this.playersByClubCache.set(p.clubId, []);
        }
        this.playersByClubCache.get(p.clubId).push(p);
    });
},

getClubPlayers(clubId) {
    if (!this.playersByClubCache) this.buildPlayersByClubCache();
    return this.playersByClubCache.get(clubId) || [];
},

invalidatePlayerCache() {
    this.playersByClubCache = null;
},

// Escalar time - escolhe melhores jogadores para formação FIXA do time
// Prioriza: 1) jogador na posição correta com maior overall
//           2) se não houver, pega jogador com maior overall disponível (com penalidade de -10 na partida)
selectLineup(clubId) {
    let clubPlayers = this.getClubPlayers(clubId);
    
    if (clubPlayers.length < 11) {
        // Gerar jogadores fictícios se necessário
        this.generateFicticiousPlayers(clubId, Math.max(0, 20 - clubPlayers.length));
        this.invalidatePlayerCache();
        clubPlayers = this.getClubPlayers(clubId);
    }
    
    const availablePlayers = [...clubPlayers]; // Cópia para não modificar original
    
    // Usar formação FIXA do time
    const formationKey = this.getClubFormation(clubId);
    const formation = this.formations[formationKey];
    
    const lineup = [];
    const usedPlayers = new Set();
    
    // PASSO 1: Para cada posição, primeiro tenta preencher com jogador da posição correta
    const positionsNeeded = formation.positions.map((requiredRole, index) => ({
        index,
        requiredRole,
        filled: false,
        player: null
    }));
    
    // Ordenar jogadores por rating (maior primeiro) para garantir que os melhores são escalados primeiro
    const sortedAvailable = availablePlayers
        .filter(p => !p.retired)
        .sort((a, b) => b.rating - a.rating);
    
    // PASSO 2: Primeiro, alocar jogadores nas posições CORRETAS (maior overall primeiro)
    sortedAvailable.forEach(player => {
        if (usedPlayers.has(player.id)) return;
        
        // Encontrar posição que precisa desse role e ainda não está preenchida
        const matchingPosition = positionsNeeded.find(pos => 
            !pos.filled && pos.requiredRole === player.role
        );
        
        if (matchingPosition) {
            matchingPosition.filled = true;
            matchingPosition.player = { ...player, positionMismatch: false, lineupRole: matchingPosition.requiredRole };
            usedPlayers.add(player.id);
        }
    });
    
    // PASSO 3: Preencher posições vazias com jogadores restantes (maior overall primeiro, com penalidade)
    positionsNeeded.forEach(pos => {
        if (pos.filled) return;
        
        // Encontrar jogador com maior rating que ainda não foi usado
        let bestPlayer = null;
        let bestRating = -1;
        
        sortedAvailable.forEach(player => {
            if (usedPlayers.has(player.id)) return;
            if (player.rating > bestRating) {
                bestPlayer = player;
                bestRating = player.rating;
            }
        });
        
        if (bestPlayer) {
            pos.filled = true;
            pos.player = { ...bestPlayer, positionMismatch: true, lineupRole: pos.requiredRole };
            usedPlayers.add(bestPlayer.id);
        }
    });
    
    // Montar lineup na ordem correta
    positionsNeeded.forEach(pos => {
        if (pos.player) {
            lineup.push(pos.player);
        }
    });
    
    return { lineup, formation: formationKey };
},
generatePlayerName(countryId) {
    // Buscar o namesCountryId do país para encontrar os nomes corretos
    const country = this.countriesMap ? this.countriesMap.get(countryId) : this.countries.find(c => c.id === countryId);
    const namesId = country?.namesCountryId || countryId;
    
    const countryNames = this.playerFicticiousNames.filter(
        n => n.namesCountryId === namesId
    );
    
    const defaultFirstNames = ['João', 'Pedro', 'Lucas', 'Gabriel', 'Carlos', 'André', 'Rafael', 'Bruno', 'Thiago', 'Felipe',
                              'Alex', 'Michael', 'Daniel', 'David', 'James', 'John', 'Thomas', 'Paul', 'Mark', 'Kevin',
                              'Jean', 'Pierre', 'François', 'Nicolas', 'Antoine', 'Marco', 'Giuseppe', 'Francesco', 'Carlos',
                              'Diego', 'Javier', 'Miguel', 'Alejandro', 'Hiroshi', 'Takumi', 'Kenji', 'Satoshi'];
    
    const defaultLastNames = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Ferreira', 'Rodrigues', 'Almeida', 'Lima',
                             'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Martinez', 'Rodriguez', 'Wilson', 'Davis',
                             'Martin', 'Bernard', 'Petit', 'Dubois', 'Moreau', 'Rossi', 'Russo', 'Ferrari', 'Esposito', 'Romano',
                             'Gonzalez', 'Fernandez', 'Lopez', 'Perez', 'Sanchez', 'Tanaka', 'Suzuki', 'Yamamoto', 'Nakamura'];
    
    const firstNames = countryNames.filter(n => n.firstName === 0);
    const lastNames = countryNames.filter(n => n.firstName === 1);
    
    let firstName, lastName;
    
    if (firstNames.length > 0) {
        firstName = this.weightedRandomSelect(firstNames);
    } else {
        firstName = defaultFirstNames[Math.floor(Math.random() * defaultFirstNames.length)];
    }
    
    if (lastNames.length > 0) {
        lastName = this.weightedRandomSelect(lastNames);
    } else {
        lastName = defaultLastNames[Math.floor(Math.random() * defaultLastNames.length)];
    }
    
    return `${firstName} ${lastName}`;
},

generateYouthPlayer(clubId) {
    const club = this.getClub(clubId);
    if (!club) return;
    
    const youthLevel = Math.max(1, Math.min(20, club.youth || 1));
    const lambda = this.YOUTH_LAMBDA_TABLE[youthLevel];
    
    let playerCountryId = this.resolvePlayerCountry(club.countryId);
    let name = this.generatePlayerName(playerCountryId);
    
    if (!name) {
        playerCountryId = club.countryId;
        name = this.generatePlayerName(playerCountryId);
        if (!name) return;
    }
    
    const age = 16 + Math.floor(Math.random() * 4);
    const currentYear = new Date().getFullYear() + this.seasonHistory.length;
    const dob = currentYear - age;
    
    let rating = this.poisson(lambda.rating - 40) + 40;
    rating = Math.max(30, Math.min(95, rating));
    
    let potentialGain = this.poisson(lambda.potential);
    potentialGain = Math.max(1, potentialGain);
    const ratingPotential = Math.min(99, rating + potentialGain);
    
    const roles = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const role = roles[Math.floor(Math.random() * roles.length)];
    
    this.players.push({
        id: `youth_${clubId}_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
        name,
        rating,
        ratingPotential,
        clubId,
        countryId: playerCountryId,
        role,
        dob,
        retired: false,
        isYouth: true,
        _generated: true
    });
},

generateFicticiousPlayers(clubId, count) {
    const club = this.getClub(clubId);
    if (!club) return;

    const minPositions = {
        1: 2, 2: 3, 3: 3, 4: 4, 5: 3, 6: 3, 7: 3, 8: 4, 9: 4
    };

    const existingPlayers = this.players.filter(p => p.clubId === clubId && !p.retired);
    const existingByRole = {};
    existingPlayers.forEach(p => existingByRole[p.role] = (existingByRole[p.role] || 0) + 1);

    const neededPositions = [];
    Object.entries(minPositions).forEach(([role, min]) => {
        const roleNum = parseInt(role);
        const existing = existingByRole[roleNum] || 0;
        const needed = Math.max(0, min - existing);
        for (let i = 0; i < needed; i++) neededPositions.push(roleNum);
    });

    const totalNeeded = Math.max(count, neededPositions.length);
    const rolesToGenerate = [...neededPositions];
    const allRoles = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    while (rolesToGenerate.length < totalNeeded) {
        rolesToGenerate.push(allRoles[Math.floor(Math.random() * allRoles.length)]);
    }

    for (let i = 0; i < totalNeeded; i++) {
        const playerCountryId = club.countryId;
        let name = this.generatePlayerName(playerCountryId);
        if (!name) continue;

        const teamRating = club.rating || 50;
        const variation = (Math.random() + Math.random() + Math.random()) / 3;
        const ratingOffset = -10 + variation * 14;
        let rating = Math.round(teamRating + ratingOffset);
        rating = Math.max(30, Math.min(97, rating));

        const potentialGain = 0;
        const finalPotential = Math.min(99, rating + potentialGain);

        const role = rolesToGenerate[i];
        const currentYear = new Date().getFullYear() + this.seasonHistory.length;
        const age = 22 + Math.floor(Math.random() * 4);
        const dob = currentYear - age;

        this.players.push({
            id: `gen_${clubId}_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
            name,
            rating: Math.round(rating),
            ratingPotential: Math.round(finalPotential),
            clubId,
            countryId: playerCountryId,
            role,
            dob,
            retired: false,
            _generated: true
        });
    }
},
// Seleção ponderada por peso
weightedRandomSelect(items) {
    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
    
    if (totalWeight === 0) {
        // todos iguais → random puro
        return items[Math.floor(Math.random() * items.length)].name;
    }
    
    let random = Math.random() * totalWeight;
    
    for (const item of items) {
        random -= item.weight;
        if (random <= 0) return item.name;
    }
    
    return items[0].name;
},

// Simular quem marcou os gols
// Usa lineupRole para calcular fator de gols baseado na posição escalada
simulateGoalScorers(lineup, goals) {
    if (goals === 0 || lineup.length === 0) return [];
    
    const scorers = [];
    
    // Calcular peso de cada jogador para marcar gol
    // Usar lineupRole (posição na escalação) para o fator, não o role original
    const weights = lineup.map(player => {
        const roleInfo = this.roleMap[player.lineupRole] || { factor: 1.0 };
        let rating = player.rating;
        // Penalidade de -10 se jogador está fora de posição
        if (player.positionMismatch) rating -= 10;
        return { player, weight: rating * roleInfo.factor };
    });
    
    // Para cada gol, sortear marcador baseado em poisson individual
    for (let g = 0; g < goals; g++) {
        let maxPoisson = -1;
        let scorer = null;
        
        weights.forEach(({ player, weight }) => {
            const lambda = weight / 16; // Normalizar para poisson
            const poissonValue = this.poisson(lambda) + Math.random(); // Adicionar aleatoriedade
            if (poissonValue > maxPoisson) {
                maxPoisson = poissonValue;
                scorer = player;
            }
        });
        
        if (scorer) {
            scorers.push(scorer);
            // Atualizar estatísticas do jogador
            this.addPlayerGoal(scorer.id);
        }
    }
    
    return scorers;
},

// Cache para stats do ano atual - reiniciado no início de cada temporada
playerStatsCache: null,
currentStatsYear: 0,

getPlayerStatsCacheKey(playerId, year) {
    return `${playerId}_${year}`;
},

ensurePlayerStatsCache() {
    const currentYear = this.seasonHistory.length + 1;
    if (this.currentStatsYear !== currentYear || !this.playerStatsCache) {
        this.playerStatsCache = new Map();
        this.currentStatsYear = currentYear;
        // Popular cache com stats existentes do ano atual
        this.playerStats.forEach(s => {
            if (s.year === currentYear) {
                this.playerStatsCache.set(this.getPlayerStatsCacheKey(s.playerId, s.year), s);
            }
        });
    }
},

// Adicionar gol às estatísticas do jogador
addPlayerGoal(playerId) {
    this.ensurePlayerStatsCache();
    const currentYear = this.seasonHistory.length + 1;
    const cacheKey = this.getPlayerStatsCacheKey(playerId, currentYear);
    let stat = this.playerStatsCache.get(cacheKey);
    
    if (!stat) {
        const player = this.players.find(p => p.id === playerId);
        stat = {
            playerId,
            year: currentYear,
            clubId: player ? player.clubId : null,
            goals: 0,
            games: 0
        };
        this.playerStats.push(stat);
        this.playerStatsCache.set(cacheKey, stat);
    }
    
    stat.goals++;
},

// Adicionar jogo às estatísticas do jogador
addPlayerGame(playerId) {
    this.ensurePlayerStatsCache();
    const currentYear = this.seasonHistory.length + 1;
    const cacheKey = this.getPlayerStatsCacheKey(playerId, currentYear);
    let stat = this.playerStatsCache.get(cacheKey);
    
    if (!stat) {
        const player = this.players.find(p => p.id === playerId);
        stat = {
            playerId,
            year: currentYear,
            clubId: player ? player.clubId : null,
            goals: 0,
            games: 0
        };
        this.playerStats.push(stat);
        this.playerStatsCache.set(cacheKey, stat);
    }
    
    stat.games++;
},

evolvePlayersEndOfSeason() {
    const currentYear = new Date().getFullYear() + this.seasonHistory.length;
    
    this.players.forEach(player => {
        if (player.retired) return;
        
        const age = currentYear - player.dob;
        
        // =====================
        // APOSENTADORIA
        // =====================
        if (age >= 33) {
            const retireChance = Math.min(0.8, (age - 32) * 0.1);
            if (Math.random() < retireChance) {
                player.retired = true;
                return;
            }
            
            // Queda progressiva após 33
            const decline = (age - 32) * (0.4 + Math.random() * 0.6);
            player.rating = Math.max(20, player.rating - decline);
            return;
        }
        
        // =====================
        // EVOLUÇÃO
        // =====================
        if (player.rating >= player.ratingPotential) return;
        
        // Fator de crescimento por idade
        let growthFactor =
            age <= 18 ? 4.5 :
            age <= 21 ? 3.8 :
            age <= 24 ? 2.8 :
            age <= 27 ? 1.6 :
            age <= 30 ? 0.8 : 0;
        
        if (growthFactor <= 0) return;
        
        let growth = Math.random() * growthFactor;
        
        // Bônus para jogadores da base jovem
        if (player.isYouth && age <= 22) {
            growth *= 1.3;
        }
        
        // Limite anual realista
        const maxAnnualGrowth =
            age <= 18 ? 6 :
            age <= 21 ? 5 :
            age <= 24 ? 4 :
            age <= 27 ? 3 : 2;
        
        growth = Math.min(growth, maxAnnualGrowth);
        
        player.rating = Math.min(
            player.ratingPotential,
            player.rating + growth
        );
    });
},
runTransferWindow() {
    // Limpar ofertas rejeitadas da temporada anterior
    this.rejectedOffers = [];
    
    // Criar lista de jogadores disponíveis para transferência
    const transferList = this.createTransferList();
    
    // Cada time analisa suas necessidades e tenta contratar
    const shuffledClubs = [...this.clubs].sort(() => Math.random() - 0.5);
    
    shuffledClubs.forEach(club => {
        this.processClubTransfers(club, transferList);
    });
},

// -------------------------------
// CALCULA IMPORTÂNCIA DO JOGADOR NO ELENCO
// Retorna valor entre 0 (baixa) e 1 (essencial)
// -------------------------------
calculatePlayerImportance(player, club) {
    const clubPlayers = this.players.filter(p => p.clubId === club.id && !p.retired);
    if (clubPlayers.length === 0) return 0.5;
    
    // Média do elenco
    const avgRating = clubPlayers.reduce((s, p) => s + p.rating, 0) / clubPlayers.length;
    
    // Jogadores da mesma posição
    const samePositionPlayers = clubPlayers.filter(p => p.role === player.role);
    const positionAvg = samePositionPlayers.length > 0 ?
        samePositionPlayers.reduce((s, p) => s + p.rating, 0) / samePositionPlayers.length : avgRating;
    
    // É o melhor da posição?
    const isBestInPosition = samePositionPlayers.every(p => p.rating <= player.rating);
    
    // Quantos jogadores tem na posição (escassez)
    const positionScarcity = samePositionPlayers.length <= 2 ? 0.3 : 0;
    
    // Quão acima da média do time ele está
    const aboveTeamAvg = Math.max(0, (player.rating - avgRating) / 20);
    
    // Potencial alto adiciona importância
    const potentialBonus = Math.max(0, (player.ratingPotential - player.rating) / 30);
    
    let importance = 0.1; // base
    importance += aboveTeamAvg * 0.3;
    importance += potentialBonus * 0.15;
    importance += positionScarcity;
    if (isBestInPosition) importance += 0.2;
    
    return Math.min(1, Math.max(0, importance));
},

// -------------------------------
// CALCULA PREÇO PEDIDO PELO TIME VENDEDOR
// Entre 10% e 30% acima do valor de mercado
// -------------------------------
calculateAskingPrice(player, sellingClub, baseValue) {
    const importance = this.calculatePlayerImportance(player, sellingClub);
    
    // Times com mais dinheiro tendem a pedir mais (podem se dar ao luxo)
    const wealthFactor = Math.min(0.05, sellingClub.transferBalance / 100000000);
    
    // Multiplicador entre 1.10 (10%) e 1.30 (30%)
    // Importância alta = pede mais
    const multiplier = 1.10 + (importance * 0.20) + wealthFactor;
    
    return baseValue * multiplier;
},

// -------------------------------
// AVALIA SE O TIME VENDEDOR ACEITA A OFERTA
// -------------------------------
evaluateOffer(player, sellingClub, offerValue, baseValue) {
    const askingPrice = this.calculateAskingPrice(player, sellingClub, baseValue);
    const importance = this.calculatePlayerImportance(player, sellingClub);
    
    // Se oferta >= preço pedido, aceita automaticamente
    if (offerValue >= askingPrice) {
        return { accepted: true, reason: 'offer_accepted' };
    }
    
    // Margem de negociação - pode aceitar até 5% abaixo do preço pedido
    const minAcceptable = askingPrice * 0.95;
    if (offerValue >= minAcceptable) {
        // Chance de aceitar baseada em quão próximo está do preço pedido
        const acceptChance = (offerValue - minAcceptable) / (askingPrice - minAcceptable);
        if (Math.random() < acceptChance) {
            return { accepted: true, reason: 'negotiated' };
        }
    }
    
    // Jogadores muito importantes raramente são vendidos abaixo do preço
    if (importance > 0.7 && offerValue < askingPrice) {
        return { 
            accepted: false, 
            reason: 'key_player',
            askingPrice: askingPrice
        };
    }
    
    // Se o time vendedor precisa de dinheiro (balanço baixo), mais propenso a aceitar
    if (sellingClub.transferBalance < 1000000 && offerValue >= baseValue * 1.05) {
        return { accepted: true, reason: 'financial_need' };
    }
    
    // Oferta muito baixa - rejeição
    return { 
        accepted: false, 
        reason: 'offer_too_low',
        askingPrice: askingPrice
    };
},

// -------------------------------
// LISTA DE JOGADORES PARA TRANSFERÊNCIA
// -------------------------------
createTransferList() {
    const currentYear = new Date().getFullYear() + this.seasonHistory.length;
    const transferList = [];
    
    this.players.forEach(player => {
        if (player.retired) return; // ignora aposentados
        const club = this.getClub(player.clubId);
        if (!club) return;
        
        const baseValue = this.calcPlayerValue(player);
        
        transferList.push({
            player,
            value: baseValue,
            askingPrice: this.calculateAskingPrice(player, club, baseValue),
            age: currentYear - player.dob,
            sellingClub: club,
            importance: this.calculatePlayerImportance(player, club)
        });
    });
    
    return transferList;
},

// -------------------------------
// PROCESSA TRANSFERÊNCIAS DE UM CLUBE
// -------------------------------
processClubTransfers(club, transferList) {
    let clubPlayers = this.players.filter(p => p.clubId === club.id && !p.retired);
    let remainingBudget = club.transferBalance;
    
    const idealCount = { 1: 2, 2: 2, 3: 2, 4: 4, 5: 2, 6: 2, 7: 2, 8: 4, 9: 3 };
    
    // Quantos jogadores o clube consegue comprar com orçamento médio
    if (transferList.length === 0) return;
    const avgPlayerValue = transferList.reduce((s, t) => s + t.value, 0) / transferList.length;
    const possibleBuys = avgPlayerValue > 0 ? Math.max(1, Math.floor(remainingBudget / avgPlayerValue)) : 1;
    
    // Criar fila de posições fracas, repetindo mais vezes as mais abaixo da média
    let needs = this.analyzeTeamNeeds(club, clubPlayers);
    let roleQueue = [];
    Object.keys(needs).forEach(role => {
        const deficit = Math.max(0, needs[role].priority);
        const repeats = Math.ceil(deficit / 5) + 1;
        for (let i = 0; i < repeats; i++) roleQueue.push(parseInt(role));
    });
    
    // Embaralhar fila
    roleQueue = roleQueue.sort(() => Math.random() - 0.5);
    
    let negotiationAttempts = 0;
    const maxAttempts = possibleBuys * 3; // Permite mais tentativas para negociação
    
    for (let i = 0; i < maxAttempts && remainingBudget > 100000 && roleQueue.length > 0; i++) {
        const roleNum = roleQueue[0];
        
        // Filtrar candidatos disponíveis (considerando que pode pagar o preço pedido)
        let candidates = transferList.filter(t =>
            t.player.role === roleNum &&
            t.sellingClub.id !== club.id &&
            t.askingPrice <= remainingBudget * 1.1 // Margem para negociação
        );
        
        if (!candidates.length) {
            roleQueue.shift();
            continue;
        }
        
        // Score balanceado: melhora a posição sem exagero
        const positionPlayers = clubPlayers.filter(p => p.role === roleNum);
        const positionAvg = positionPlayers.length ?
            positionPlayers.reduce((s, p) => s + p.rating, 0) / positionPlayers.length :
            0;
        
        const teamAvg = clubPlayers.length ?
            clubPlayers.reduce((s, p) => s + p.rating, 0) / clubPlayers.length :
            50;
        
        candidates.forEach(c => {
            const deficit = Math.max(0, teamAvg - positionAvg);
            const potentialBonus = c.player.ratingPotential - c.player.rating;
            // Prioriza jogadores com preço pedido mais acessível
            const priceEfficiency = 1 - (c.askingPrice / (remainingBudget * 2));
            c.score = c.player.rating + deficit + potentialBonus * 0.5 + priceEfficiency * 10;
        });
        
        candidates.sort((a, b) => b.score - a.score);
        const target = candidates[0];
        
        // Tenta negociar - oferta inicial é o valor de mercado + 10%
        let offerValue = target.value * 1.10;
        
        // Se tem bastante dinheiro, pode oferecer mais
        if (remainingBudget > target.askingPrice * 2) {
            offerValue = target.value * 1.15;
        }
        
        // Não oferece mais do que tem
        offerValue = Math.min(offerValue, remainingBudget);
        
        const negotiation = this.negotiateTransfer(
            target.player, 
            target.sellingClub, 
            club, 
            offerValue,
            target.value,
            target.askingPrice,
            remainingBudget
        );
        
        if (negotiation.success) {
            remainingBudget -= negotiation.finalValue;
            const idx = transferList.findIndex(t => t.player.id === target.player.id);
            if (idx !== -1) transferList.splice(idx, 1);
            clubPlayers.push(target.player);
            roleQueue.shift(); // Posição preenchida
            negotiationAttempts = 0;
        } else {
            negotiationAttempts++;
            // Se falhou muitas vezes na mesma posição, pula para a próxima
            if (negotiationAttempts >= 3) {
                roleQueue.shift();
                negotiationAttempts = 0;
            }
        }
    }
},

// -------------------------------
// NEGOCIAÇÃO DE TRANSFERÊNCIA
// Pode haver múltiplas rodadas de negociação
// -------------------------------
negotiateTransfer(player, sellingClub, buyingClub, initialOffer, baseValue, askingPrice, maxBudget) {
    let currentOffer = initialOffer;
    let rounds = 0;
    const maxRounds = 3;
    
    while (rounds < maxRounds) {
        const evaluation = this.evaluateOffer(player, sellingClub, currentOffer, baseValue);
        
        if (evaluation.accepted) {
            // Transferência aceita!
            const success = this.executeTransfer(player, sellingClub, buyingClub, currentOffer);
            return { 
                success, 
                finalValue: currentOffer,
                rounds: rounds + 1
            };
        }
        
        // Rejeição - registrar oferta rejeitada
        this.rejectedOffers.push({
            playerId: player.id,
            playerName: player.name,
            fromClubId: sellingClub.id,
            fromClubName: sellingClub.name,
            toClubId: buyingClub.id,
            toClubName: buyingClub.name,
            offerValue: currentOffer,
            askingPrice: evaluation.askingPrice || askingPrice,
            reason: evaluation.reason,
            round: rounds + 1
        });
        
        // Tenta aumentar a oferta
        const newOffer = currentOffer * 1.08; // Aumenta 8%
        
        // Se não pode pagar mais ou já está perto do preço pedido, desiste
        if (newOffer > maxBudget || currentOffer >= askingPrice * 0.98) {
            return { 
                success: false, 
                reason: 'negotiation_failed',
                finalOffer: currentOffer
            };
        }
        
        currentOffer = newOffer;
        rounds++;
    }
    
    return { 
        success: false, 
        reason: 'max_rounds_reached',
        finalOffer: currentOffer
    };
},

// -------------------------------
// ENCONTRAR MELHOR JOGADOR PARA UMA POSIÇÃO
// -------------------------------
findBestTransferTarget(club, role, needData, transferList, budget) {
    const clubPlayers = this.players.filter(p => p.clubId === club.id && !p.retired);
    const positionPlayers = clubPlayers.filter(p => p.role === role);
    const positionAvg = positionPlayers.length ?
        positionPlayers.reduce((s, p) => s + p.rating, 0) / positionPlayers.length :
        0;
    
    let candidates = transferList.filter(t =>
        t.player.role === role &&
        t.sellingClub.id !== club.id &&
        t.askingPrice <= budget * 1.1
    );
    
    if (!candidates.length) return null;
    
    candidates.forEach(c => {
        const deficit = Math.max(0, 100 - positionAvg);
        const potentialBonus = c.player.ratingPotential - c.player.rating;
        c.score = c.player.rating + deficit + potentialBonus * 0.5;
    });
    
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
},

// -------------------------------
// ANALISA NECESSIDADES DO TIME
// -------------------------------
analyzeTeamNeeds(club, clubPlayers) {
    const needs = {};
    const avgTeamRating = clubPlayers.length ?
        clubPlayers.reduce((s, p) => s + p.rating, 0) / clubPlayers.length :
        50;
    
    Object.keys(this.roleMap).forEach(role => {
        const players = clubPlayers.filter(p => p.role === Number(role));
        const avgRating = players.length ?
            players.reduce((s, p) => s + p.rating, 0) / players.length :
            0;
        
        needs[role] = {
            avgRating,
            priority: avgTeamRating - avgRating // posições abaixo da média ganham prioridade
        };
    });
    
    return needs;
},

// -------------------------------
// EXECUTA TRANSFERÊNCIA
// -------------------------------
executeTransfer(player, sellingClub, buyingClub, value) {
    const sellerPlayers = this.players.filter(p => p.clubId === sellingClub.id && !p.retired && p.id !== player.id);
    const samePositionPlayers = sellerPlayers.filter(p => p.role === player.role);
    
    if (samePositionPlayers.length < 1 || sellerPlayers.length < 11) return false;
    if (buyingClub.transferBalance < value) return false;
    
    player.clubId = buyingClub.id;
    buyingClub.transferBalance -= value;
    sellingClub.transferBalance += value;
    
    const currentYear = this.seasonHistory.length + 1;
    this.playerStats.push({
        playerId: player.id,
        year: currentYear,
        clubId: buyingClub.id,
        goals: 0,
        games: 0,
        isTransfer: true,
        fromClub: sellingClub.id,
        transferValue: value
    });
    
    return true;
},

// Gerar relatório de transferências (incluindo rejeitadas)
getTransferReport() {
    const currentYear = this.seasonHistory.length + 1;
    const transfers = this.playerStats.filter(s => s.year === currentYear && s.isTransfer);
    
    const completed = transfers.map(t => {
        const player = this.players.find(p => p.id === t.playerId);
        const fromClub = this.getClub(t.fromClub);
        const toClub = this.getClub(t.clubId);
        
        return {
            player: player?.name || 'Desconhecido',
            playerId: t.playerId,
            playerCountryId: player?.countryId || null,
            from: fromClub?.name || 'Desconhecido',
            fromId: t.fromClub,
            to: toClub?.name || 'Desconhecido',
            toId: t.clubId,
            value: this.formatValue(t.transferValue || 0),
            rawValue: t.transferValue || 0,
            status: 'completed'
        };
    });
    
    return completed;
},

// Gerar relatório de ofertas rejeitadas
getRejectedOffersReport() {
    // Agrupa por jogador (pega apenas a última oferta rejeitada para cada jogador/comprador)
    const uniqueRejections = new Map();
    
    this.rejectedOffers.forEach(offer => {
        const key = `${offer.playerId}_${offer.toClubId}`;
        const existing = uniqueRejections.get(key);
        if (!existing || offer.round > existing.round) {
            uniqueRejections.set(key, offer);
        }
    });
    
    return Array.from(uniqueRejections.values()).map(offer => {
        const player = this.players.find(p => p.id === offer.playerId);
        return {
            player: offer.playerName,
            playerId: offer.playerId,
            playerCountryId: player?.countryId || null,
            from: offer.fromClubName,
            fromId: offer.fromClubId,
            to: offer.toClubName,
            toId: offer.toClubId,
            offerValue: this.formatValue(offer.offerValue),
            askingPrice: this.formatValue(offer.askingPrice),
            reason: this.getReasonText(offer.reason),
            status: 'rejected'
        };
    });
},

// Texto legível para o motivo da rejeição
getReasonText(reason) {
    const reasons = {
        'key_player': 'Jogador importante',
        'offer_too_low': 'Oferta baixa',
        'negotiation_failed': 'Negociação falhou',
        'max_rounds_reached': 'Sem acordo'
    };
    return reasons[reason] || 'Recusada';
},

// Calcular valor de mercado do jogador
calcPlayerValue(player) {
    const currentYear = new Date().getFullYear() + this.seasonHistory.length;
    const age = currentYear - player.dob;
    
    const a = 3.4;
    const b = 0.196;
    let base = a * Math.exp(b * player.rating);
    
    // Correção de rating baixo (igual ao original)
    const m_rating = Math.pow(player.rating / 86, 2);
    base *= m_rating;
    
    const m_pot = 1 + (player.ratingPotential - player.rating) / 40;
    
    let m_idade;
    if (age <= 20) m_idade = 1.8;
    else if (age <= 23) m_idade = 1.5;
    else if (age <= 26) m_idade = 1.2;
    else if (age <= 29) m_idade = 1.0;
    else if (age <= 33) m_idade = 0.7;
    else if (age <= 36) m_idade = 0.4;
    else if (age <= 39) m_idade = 0.2;
    else if (age <= 42) m_idade = 0.1;
    else if (age <= 44) m_idade = 0.05;
    else m_idade = 0.2; // ✅ IGUAL ao código antigo
    
    // Posições por número (mantido)
    const pos_mult = {
        1: 0.7,
        4: 0.8,
        2: 0.9,
        3: 0.9,
        5: 0.9,
        6: 0.9,
        8: 1.0,
        7: 1.1,
        9: 1.2
    };
    
    const m_pos = pos_mult[player.role] || 1.0;
    
    return base * m_pot * m_idade * m_pos; // ✅ SEM multiplicador final
},

formatValue(valor) {
    if (valor >= 1000000) {
        return "$" + Math.floor(valor / 100000) / 10 + "M";
    }
    if (valor >= 1000) {
        return "$" + Math.floor(valor / 1000) + "K";
    }
    return "$" + Math.floor(valor);
},

// Revelar jogadores da academia juvenil no início da temporada
// Sistema baseado no nível Youth (1-20) do clube
// Sempre revela 1-2 jogadores por temporada em TODOS os clubes
revealYouthPlayers() {
    this.clubs.forEach(club => {
        const youthLevel = club.youth || 10;
        
        // Sempre revela 1 jogador, com chance de revelar 2º baseada no nível youth
        const secondPlayerChance = youthLevel / 20; // 5% a 100%
        const playersToReveal = 1 + (Math.random() < secondPlayerChance ? 1 : 0);
        
        for (let i = 0; i < playersToReveal; i++) {
            this.generateYouthPlayer(club.id);
        }
    });
},
getYouthUpgradeCost(currentLevel) {
    if (currentLevel >= 20) return null; // Já está no máximo
    
    const baseValue = 10000; // base mais cara
    let cost = baseValue;
    
    for (let level = 1; level < currentLevel; level++) {
        if (level < 12) {
            cost *= 2; // Dobra até o nível 12
        } else {
            cost *= 1.4; // Depois cresce mais devagar (mas ainda dói)
        }
    }
    
    // Custo para subir para o PRÓXIMO nível
    if (currentLevel < 12) {
        return Math.round(cost * 2);
    } else {
        return Math.round(cost * 1.4);
    }
},

// Fazer upgrade do Youth de um clube (interno)
upgradeYouth(clubId) {
    const club = this.getClub(clubId);
    if (!club) return false;
    
    const currentLevel = club.youth || 10;
    if (currentLevel >= 20) return false;
    
    const cost = this.getYouthUpgradeCost(currentLevel);
    if (club.transferBalance < cost) return false;
    
    club.transferBalance -= cost;
    club.youth = currentLevel + 1;
    
    return true;
},

// Times decidem automaticamente se vão investir no Youth
// Chamado no início de cada temporada
// Regra simples: se tem pelo menos 2x o custo, faz o upgrade
processYouthUpgrades() {
    this.clubs.forEach(club => {
        const currentLevel = club.youth || 10;
        if (currentLevel >= 20) return; // Já no máximo
        
        const cost = this.getYouthUpgradeCost(currentLevel);
        if (!cost) return;
        
        // Se tem pelo menos 2x o custo, faz o upgrade
        if (club.transferBalance >= cost * 2) {
            this.upgradeYouth(club.id);
        }
    });
},

// Distribuir prêmios por posição
distributeAwards(stageId, standings) {
    const awards = this.competitionStageAwards.filter(a => a.stageId === stageId);
    
    awards.forEach(award => {
        const teamAtPosition = standings[award.place - 1];
        if (teamAtPosition) {
            const club = this.getClub(teamAtPosition.id);
            if (club) {
                club.transferBalance = (club.transferBalance || 0) + award.award;
            }
        }
    });
},

    getClub(id) { 
        if (this.clubsMap) return this.clubsMap.get(id);
        return this.clubs.find(c => c.id === id); 
    },

    buildClubsMap() {
        this.clubsMap = new Map(this.clubs.map(c => [c.id, c]));
    },

    buildCountriesMaps() {
        this.countriesMap = new Map(this.countries.map(c => [c.id, c]));
        this.countriesByContinent = new Map();
        this.countries.forEach(c => {
            if (!c.continentId) return;
            if (!this.countriesByContinent.has(c.continentId)) {
                this.countriesByContinent.set(c.continentId, []);
            }
            this.countriesByContinent.get(c.continentId).push(c);
        });
    },

    // Determinar o país de um jogador gerado baseado na tabela PlayerYouthReveal
    // Se a tabela tem entradas para o país do clube, usa as probabilidades definidas
    // A % que sobrar: 90% mesmo continente, 10% país totalmente aleatório
    resolvePlayerCountry(clubCountryId) {
        const reveals = this.playerYouthReveal.filter(r => r.countryId === clubCountryId);
        
        if (reveals.length > 0) {
            const totalDefinedProb = reveals.reduce((sum, r) => sum + r.probability, 0);
            const roll = Math.random() * 100;
            
            // Verificar se cai em algum país definido na tabela
            let cumulative = 0;
            for (const reveal of reveals) {
                cumulative += reveal.probability;
                if (roll < cumulative) {
                    return reveal.countryPlayerId;
                }
            }
            
            // Se não caiu em nenhum país definido, estamos na % restante
            // 90% mesmo continente, 10% país totalmente aleatório
            const remainingRoll = Math.random();
            
            const clubCountry = this.countriesMap ? this.countriesMap.get(clubCountryId) : this.countries.find(c => c.id === clubCountryId);
            if (!clubCountry || !clubCountry.continentId) {
                return clubCountryId; // fallback
            }
            
            if (remainingRoll < 0.9) {
                // 90% da sobra: mesmo continente
                const sameContinent = this.countriesByContinent ? 
                    this.countriesByContinent.get(clubCountry.continentId) : 
                    this.countries.filter(c => c.continentId === clubCountry.continentId);
                
                if (sameContinent && sameContinent.length > 1) {
                    const otherCountries = sameContinent.filter(c => c.id !== clubCountryId);
                    if (otherCountries.length > 0) {
                        return otherCountries[Math.floor(Math.random() * otherCountries.length)].id;
                    }
                }
                return clubCountryId; // fallback
            } else {
                // 10% da sobra: país totalmente aleatório
                const allOtherCountries = this.countries.filter(c => c.id !== clubCountryId && c.continentId);
                if (allOtherCountries.length > 0) {
                    return allOtherCountries[Math.floor(Math.random() * allOtherCountries.length)].id;
                }
                return clubCountryId; // fallback
            }
        }
        
        // Fallback se não há entradas na tabela: 90% mesmo continente, 10% aleatório
        const clubCountry = this.countriesMap ? this.countriesMap.get(clubCountryId) : this.countries.find(c => c.id === clubCountryId);
        if (!clubCountry || !clubCountry.continentId) {
            return clubCountryId;
        }
        
        if (Math.random() < 0.9) {
            const sameContinent = this.countriesByContinent ? 
                this.countriesByContinent.get(clubCountry.continentId) : 
                this.countries.filter(c => c.continentId === clubCountry.continentId);
            
            if (sameContinent && sameContinent.length > 0) {
                return sameContinent[Math.floor(Math.random() * sameContinent.length)].id;
            }
            return clubCountryId;
        }
        
        const allOtherCountries = this.countries.filter(c => c.id !== clubCountryId && c.continentId);
        if (allOtherCountries.length > 0) {
            return allOtherCountries[Math.floor(Math.random() * allOtherCountries.length)].id;
        }
        return clubCountryId;
    },

    async loadLogo(id) {
        if (!id) return "";
        if (this.logoCache.has(id)) return this.logoCache.get(id);
        if (!this.zipData) return "";
        try {
            const file = this.zipData.file(`club_logos/${id}.png`);
            if (!file) { this.logoCache.set(id, ""); return ""; }
            const blob = await file.async("blob");
            const url = URL.createObjectURL(blob);
            this.logoCache.set(id, url); 
            return url;
        } catch (e) { 
            this.logoCache.set(id, "");
            return ""; 
        }
    },

    async loadFlag(countryId) {
        if (!countryId) return "";
        if (this.flagCache.has(countryId)) return this.flagCache.get(countryId);
        if (!this.zipData) return "";
        try {
            const file = this.zipData.file(`country_flags/${countryId}.png`);
            if (!file) { this.flagCache.set(countryId, ""); return ""; }
            const blob = await file.async("blob");
            const url = URL.createObjectURL(blob);
            this.flagCache.set(countryId, url); 
            return url;
        } catch (e) { 
            this.flagCache.set(countryId, "");
            return ""; 
        }
    },

    // PERF: Poisson with exp cache - avoids repeated Math.exp() for same lambda values
    poisson(lambda) {
        if (lambda <= 0) return 0;
        // Round to 2 decimals to maximize cache hits
        const key = (lambda * 100 | 0);
        let L = this._poissonExpCache.get(key);
        if (L === undefined) {
            L = Math.exp(-lambda);
            this._poissonExpCache.set(key, L);
        }
        let k = 0, p = 1;
        do { k++; p *= Math.random(); } while (p > L);
        return k - 1;
    },

    calcExpectedGoals(teamRating, oppRating, isHome = false) {
        const F = 4.5;
        const atk = teamRating + (isHome ? F : 0);
        const def = oppRating + (isHome ? 0 : F);
        const diff = atk - def;
        return Math.max(1.2 + 0.04 * Math.sign(diff) * (Math.abs(diff) ** 1.2), 0.1);
    },

    initializeStandings(teams) {
        this.standings = teams.map(team => ({
            id: team.id, name: team.name, played: 0, won: 0, drawn: 0, lost: 0,
            goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
            expectedGoalsFor: 0, expectedGoalsAgainst: 0
        }));
        this.standingsMap = new Map(this.standings.map(t => [t.id, t]));
    },

    updateStandings(homeId, awayId, homeScore, awayScore, homeExpected, awayExpected) {
        const homeTeam = this.standingsMap.get(homeId);
        const awayTeam = this.standingsMap.get(awayId);
        if (!homeTeam || !awayTeam) return;
        
        homeTeam.played++; awayTeam.played++;
        homeTeam.goalsFor += homeScore; homeTeam.goalsAgainst += awayScore;
        awayTeam.goalsFor += awayScore; awayTeam.goalsAgainst += homeScore;
        homeTeam.expectedGoalsFor += homeExpected; homeTeam.expectedGoalsAgainst += awayExpected;
        awayTeam.expectedGoalsFor += awayExpected; awayTeam.expectedGoalsAgainst += homeExpected;
        homeTeam.goalDifference = homeTeam.goalsFor - homeTeam.goalsAgainst;
        awayTeam.goalDifference = awayTeam.goalsFor - awayTeam.goalsAgainst;
        
        if (homeScore > awayScore) { 
            homeTeam.won++; awayTeam.lost++; homeTeam.points += 3; 
        } else if (homeScore < awayScore) { 
            homeTeam.lost++; awayTeam.won++; awayTeam.points += 3; 
        } else { 
            homeTeam.drawn++; awayTeam.drawn++; homeTeam.points++; awayTeam.points++; 
        }
    },

    sortStandings() {
        this.standings.sort((a, b) => 
            b.points - a.points || 
            b.goalDifference - a.goalDifference || 
            b.goalsFor - a.goalsFor
        );
    },

    async simulateSingleSeason(onProgress = null) {
        // IMPORTANTE: Invalidar cache de jogadores no início de cada temporada
        // para garantir que transferências, aposentadorias e novos jogadores sejam refletidos
        this.invalidatePlayerCache();
        
        // Times decidem se investem no upgrade do Youth
        this.processYouthUpgrades();
        
        // Revelar jogadores da academia no início da temporada
        this.revealYouthPlayers();
        
        // Garantir que todos os times tenham pelo menos 16 jogadores
        this.clubs.forEach(club => {
            const clubPlayers = this.players.filter(p => p.clubId === club.id && !p.retired);
            if (clubPlayers.length < 20) {
                this.generateFicticiousPlayers(club.id, 20 - clubPlayers.length);
            }
        });
        
        // Invalidar cache novamente após gerar jogadores fictícios
        this.invalidatePlayerCache();
        
        // Simular TODAS as competições de TODOS os países
        // (Reset de classificações é feito NO FINAL da temporada, após aplicar promoções)
        const allCompetitions = [...this.competitions].sort((a, b) => {
            // Ordenar por país e depois por importanceOrder
            if (a.countryId !== b.countryId) {
                return a.countryId.localeCompare(b.countryId);
            }
            return a.importanceOrder - b.importanceOrder;
        });
        
        if (allCompetitions.length === 0) {
            return null;
        }
        
        const seasonResult = {
            season: this.seasonHistory.length + 1,
            competitions: [],
            year: new Date().getFullYear() + this.seasonHistory.length
        };
        
        const sharedStageResults = new Map();
        const crossQualified = new Map();
        
        // Injetar times qualificados via type 100 da temporada anterior
        // Funciona exatamente como type 106, mas entre temporadas
        if (this.nextSeasonInjections.size > 0) {
            this.nextSeasonInjections.forEach((clubs, stageId) => {
                if (!crossQualified.has(stageId)) {
                    crossQualified.set(stageId, []);
                }
                const list = crossQualified.get(stageId);
                clubs.forEach(club => {
                    if (!list.find(c => c.id === club.id)) {
                        list.push(club);
                    }
                });
            });
            // Limpar após usar
            this.nextSeasonInjections = new Map();
        }
        
        for (let ci = 0; ci < allCompetitions.length; ci++) {
            const competition = allCompetitions[ci];
            
            // Callback de progresso
            if (onProgress) {
                onProgress(competition.name, ci, allCompetitions.length);
                await new Promise(r => setTimeout(r, 0)); // Yield para atualizar UI
            }
            
            let competitionResult;
            if (competition.type === 0) {
                const clubs = this.clubs.filter(c => c.competitions.includes(competition.id));
                if (clubs.length === 0) {
                    continue;
                }
                
                // Verificar se a competição tipo 0 tem múltiplos stages
                // Se sim, usar simulateCompetition para processar transições entre stages
                const compStages = this.competitionStages.filter(s => {
                    const compIds = s.competitionId.split(',').map(id => id.trim());
                    return compIds.includes(competition.id);
                });
                
                if (compStages.length > 1) {
                    // Múltiplos stages: usar simulateCompetition para processar transições corretamente
                    competitionResult = await this.simulateCompetition(competition, true, sharedStageResults, crossQualified);
                } else {
                    competitionResult = await this.simulateSimpleLeague(clubs, competition, true, sharedStageResults, crossQualified);
                }
            } else {
                competitionResult = await this.simulateCompetition(competition, true, sharedStageResults, crossQualified);
            }
            
            if (competitionResult) {
                // Distribuir prêmios por posição
                competitionResult.stages.forEach(stageData => {
                    if (stageData.standings && stageData.standings.length > 0) {
                        this.distributeAwards(stageData.stage.id, stageData.standings);
                    }
                });
                
                seasonResult.competitions.push(competitionResult);
            }
        }
        
        if (seasonResult.competitions.length === 0) {
            return null;
        }
        
        // PRIMEIRO limpar competições temporárias (tipos 0, 1, 3, 4)
        // para que só quem se classificar novamente participe na próxima temporada
        this.resetContinentalQualifications();
        
        // DEPOIS aplicar transições (type 100, etc.) para re-adicionar os times qualificados
        this.applyPromotionsAndRelegationsAllCountries(seasonResult);
        
        // Evoluir jogadores no final da temporada
        this.evolvePlayersEndOfSeason();
        
        // Janela de transferências
        this.runTransferWindow();
        
        // Invalidar cache após transferências para que a próxima temporada use dados atualizados
        this.invalidatePlayerCache();
        
        // Guardar relatório de transferências na temporada
        seasonResult.transfers = this.getTransferReport();
        seasonResult.rejectedOffers = this.getRejectedOffersReport();
        
        this.seasonHistory.push(seasonResult);
        
        return seasonResult;
    },

    async simulateSimpleLeague(clubs, competition, saveToSeason = false, sharedStageResults = new Map(), crossQualified = new Map()) {
        const mainStage = this.competitionStages.find(s =>
            s.competitionId.split(',').map(id => id.trim()).includes(competition.id) && s.isWinnerDecisionStage
        ) || this.competitionStages.find(s => s.competitionId.split(',').map(id => id.trim()).includes(competition.id));
        
        if (!mainStage) {
            return null;
        }
        
        if (sharedStageResults.has(mainStage.id)) {
            const stageResult = sharedStageResults.get(mainStage.id);
            
            const championId = stageResult.standings?.[0]?.id || null;
            if (saveToSeason && championId) {
                this.addChampionship(championId, competition.id);
            }
            
            return {
                competition,
                stages: [stageResult],
                championId: championId,
                type: 0
            };
        }
        
        const baseStageClubs = this.clubs.filter(club => club.stages.includes(mainStage.id) && club.originalStages.includes(mainStage.id));
        const extra = crossQualified.get(mainStage.id) || [];
        const uniqueMap = new Map();
        // Combina clubs do parâmetro, clubs do stage, e extras (crossQualified)
        [...clubs, ...baseStageClubs, ...extra].forEach(t => { if (t && !uniqueMap.has(t.id)) uniqueMap.set(t.id, t); });
        const allStageClubs = Array.from(uniqueMap.values());
        
        const stageResult = await this.simulateStage(mainStage, allStageClubs);
        
        sharedStageResults.set(mainStage.id, stageResult);
        
        if (!saveToSeason) return null;
        
        const championId = stageResult.standings?.[0]?.id || null;
        
        if (saveToSeason && championId) {
            this.addChampionship(championId, competition.id);
        }
        
        return {
            competition,
            stages: [stageResult],
            championId: championId,
            type: 0
        };
    },

    applyPromotionsAndRelegations(seasonResult) {
        const countryId = document.getElementById("seasonCountry").value;
        if (!countryId) return;
        
        const allTransitions = [];
        
        seasonResult.competitions.forEach(compData => {
            const competition = compData.competition;
            
            compData.stages.forEach(stageData => {
                const stageTransitions = this.competitionStageTransitions.filter(
                    t => t.stageIdFrom === stageData.stage.id
                );
                
                stageTransitions.forEach(transition => {
                    allTransitions.push({
                        competition,
                        stage: stageData.stage,
                        transition,
                        standings: stageData.standings,
                        groups: stageData.groups,
                        playoffBracket: stageData.playoffBracket
                    });
                });
            });
        });
        
        allTransitions.forEach(({ competition, stage, transition, standings, groups, playoffBracket }) => {
            this.processTransition(competition, stage, transition, standings, groups, playoffBracket);
        });
    },

    applyPromotionsAndRelegationsAllCountries(seasonResult) {
        const allTransitions = [];
        
        seasonResult.competitions.forEach(compData => {
            const competition = compData.competition;
            
            compData.stages.forEach(stageData => {
                const stageTransitions = this.competitionStageTransitions.filter(
                    t => t.stageIdFrom === stageData.stage.id
                );
                
                stageTransitions.forEach(transition => {
                    allTransitions.push({
                        competition,
                        stage: stageData.stage,
                        transition,
                        standings: stageData.standings,
                        groups: stageData.groups,
                        playoffBracket: stageData.playoffBracket
                    });
                });
            });
        });
        
        allTransitions.forEach(({ competition, stage, transition, standings, groups, playoffBracket }) => {
            this.processTransition(competition, stage, transition, standings, groups, playoffBracket);
        });
    },

    processTransition(competition, stage, transition, standings, groups, playoffBracket) {
        // Pular transições type 106 no fim da temporada - elas são processadas durante a simulação.
        // Re-aplicá-las no fim da temporada cria "fantasmas" em stages de competições limpas (Copa Nacional, etc.)
        if (transition.type === 106) return;
        
        // CORREÇÃO: Pular transições internas (mesma competição) - já processadas durante simulateCompetition.
        // Sem isso, handlePromotionRelegation re-adiciona stages da Copa aos clubes, causando acúmulo de times.
        const targetStage = this.competitionStages.find(s => s.id === transition.stageIdTo);
        if (targetStage) {
            const sourceCompIds = stage.competitionId.split(',').map(id => id.trim());
            const targetCompIds = targetStage.competitionId.split(',').map(id => id.trim());
            const sameCompetition = sourceCompIds.some(id => targetCompIds.includes(id));
if (sameCompetition && transition.type !== 0) return;

        }
        
        let teamsToMove = [];
        
        if (transition.place === -1) {
            teamsToMove = this.getAllTeamsFromStage(stage, standings, groups, playoffBracket);
        } else {
            teamsToMove = this.getTeamsByPosition(stage, transition.place, standings, groups, playoffBracket);
            teamsToMove = this.getEligibleTeamsWithFallback(teamsToMove, transition, standings, groups, competition);
        }
        
        teamsToMove.forEach(teamData => {
            const club = this.getClub(teamData.id);
            const targetStage = this.competitionStages.find(s => s.id === transition.stageIdTo);
            
            if (club && targetStage) {
                if (this.isTeamEligibleForTransition(club, targetStage, transition, competition)) {
                    this.applyTransition(club, targetStage, transition, competition);
                }
            }
        });
    },
    
    getEligibleTeamsWithFallback(originalTeams, transition, standings, groups, currentCompetition) {
        // Sem fallback - retorna apenas os times da posição exata indicada no CompetitionStageTransition
        return originalTeams.filter(teamData => {
            const club = this.getClub(teamData.id);
            const targetStage = this.competitionStages.find(s => s.id === transition.stageIdTo);
            return club && targetStage && this.isTeamEligibleForTransition(club, targetStage, transition, currentCompetition);
        });
    },
    
    isTeamEligibleForTransition(club, targetStage, transition, currentCompetition) {
        const targetCompetitionIds = targetStage.competitionId.split(',').map(id => id.trim());
        
        if (transition.type === 106) {
            return true;
        }
        
        if (transition.type === 0) {
            const targetCompetitions = targetCompetitionIds.map(compId =>
                this.competitions.find(c => c.id === compId)
            ).filter(Boolean);
            
            const sameCountry = targetCompetitions.some(targetComp =>
                targetComp.countryId === currentCompetition.countryId
            );
            
            if (sameCountry) {
                return true;
            }
            
            return false;
        }
        
        if (transition.type === 100) {
            return true;
        }
        
        if (transition.type === 111) {
            const blockedCompetitionIds = ['3', '4', '5'];
            const hasBlockedCompetition = club.competitions.some(compId =>
                blockedCompetitionIds.includes(compId)
            );
            
            if (!hasBlockedCompetition) {
                return true;
            }
            
            return false;
        }
        
        if (club.bTeamOf) {
            const mainTeam = this.clubs.find(c => c.id === club.bTeamOf);
            if (mainTeam) {
                const mainTeamCompetitions = mainTeam.competitions.map(compId =>
                    this.competitions.find(c => c.id === compId)
                ).filter(Boolean);
                
                const targetCompetitions = targetCompetitionIds.map(compId =>
                    this.competitions.find(c => c.id === compId)
                ).filter(Boolean);
                
                const hasConflict = targetCompetitions.some(targetComp =>
                    mainTeamCompetitions.some(mainComp =>
                        targetComp.importanceOrder <= mainComp.importanceOrder
                    )
                );
                
                if (hasConflict) {
                    return false;
                }
            }
        }
        
        return true;
    },
    
    applyTransition(club, targetStage, transition, currentCompetition) {
        const targetCompetitionIds = targetStage.competitionId.split(',').map(id => id.trim());
        
        switch (transition.type) {
            case 0:
                this.handlePromotionRelegation(club, targetStage, targetCompetitionIds, currentCompetition);
                break;
                
            case 100:
                this.handleContinentalQualification(club, targetStage, targetCompetitionIds);
                break;
                
            case 106:
                this.handleStageTransition(club, targetStage, targetCompetitionIds);
                break;
                
            case 111:
                this.handleOtherTransition(club, targetStage, targetCompetitionIds);
                break;
                
            default:
        }
    },
    
    handlePromotionRelegation(club, targetStage, targetCompetitionIds, currentCompetition) {
        const targetCompetition = this.competitions.find(c => targetCompetitionIds.includes(c.id));
        if (!targetCompetition) return;
        
        const targetCountryId = targetCompetition.countryId;
        
        const competitionsToRemove = club.competitions.filter(compId => {
            const comp = this.competitions.find(c => c.id === compId);
            return comp && comp.countryId === targetCountryId;
        });
        
        competitionsToRemove.forEach(compId => {
            // Remove de competitions e originalCompetitions
            const index = club.competitions.indexOf(compId);
            if (index !== -1) {
                club.competitions.splice(index, 1);
            }
            const origCompIndex = club.originalCompetitions.indexOf(compId);
            if (origCompIndex !== -1) {
                club.originalCompetitions.splice(origCompIndex, 1);
            }
            
            const stagesToRemove = this.competitionStages
                .filter(s => s.competitionId.split(',').map(id => id.trim()).includes(compId))
                .map(s => s.id);
            
            stagesToRemove.forEach(stageId => {
                // Remove de stages e originalStages
                const stageIndex = club.stages.indexOf(stageId);
                if (stageIndex !== -1) {
                    club.stages.splice(stageIndex, 1);
                }
                const origStageIndex = club.originalStages.indexOf(stageId);
                if (origStageIndex !== -1) {
                    club.originalStages.splice(origStageIndex, 1);
                }
            });
        });
        
        targetCompetitionIds.forEach(compId => {
            if (!club.competitions.includes(compId)) {
                club.competitions.push(compId);
            }
            if (!club.originalCompetitions.includes(compId)) {
                club.originalCompetitions.push(compId);
            }
        });
        
        if (!club.stages.includes(targetStage.id)) {
            club.stages.push(targetStage.id);
        }
        if (!club.originalStages.includes(targetStage.id)) {
            club.originalStages.push(targetStage.id);
        }
    },
    
    handleContinentalQualification(club, targetStage, targetCompetitionIds) {
        // Type 100 agora funciona como type 106, mas entre temporadas:
        // NÃO modifica club.stages/competitions (isso causava bugs)
        // Apenas adiciona ao mapa de injeções para a próxima temporada
        if (!this.nextSeasonInjections.has(targetStage.id)) {
            this.nextSeasonInjections.set(targetStage.id, []);
        }
        const injectionList = this.nextSeasonInjections.get(targetStage.id);
        if (!injectionList.find(c => c.id === club.id)) {
            injectionList.push(club);
        }
    },
    
    handleStageTransition(club, targetStage, targetCompetitionIds) {
        // Type 106: Apenas adiciona o stage sem alterar as competições do time
        // O time vai jogar naquele stage específico de outra competição, mas mantém sua competição original
        if (!club.stages.includes(targetStage.id)) {
            club.stages.push(targetStage.id);
        }
    },
    
    handleOtherTransition(club, targetStage, targetCompetitionIds) {
        targetCompetitionIds.forEach(compId => {
            if (!club.competitions.includes(compId)) {
                club.competitions.push(compId);
            }
            if (!club.originalCompetitions.includes(compId)) {
                club.originalCompetitions.push(compId);
            }
        });
        
        if (!club.stages.includes(targetStage.id)) {
            club.stages.push(targetStage.id);
        }
        if (!club.originalStages.includes(targetStage.id)) {
            club.originalStages.push(targetStage.id);
        }
    },

    getMaxPositions(standings, groups) {
        if (groups && groups.length > 0) {
            return groups.reduce((max, group) => Math.max(max, group.standings?.length || 0), 0);
        }
        return standings?.length || 0;
    },

    addChampionship(teamId, competitionId) {
        if (!this.teamTitles.has(teamId)) {
            this.teamTitles.set(teamId, { championships: new Map() });
        }
        const teamTitle = this.teamTitles.get(teamId);
        const currentCount = teamTitle.championships.get(competitionId) || 0;
        teamTitle.championships.set(competitionId, currentCount + 1);
    },

resetContinentalQualifications() {
    // Competições dos tipos 0, 1, 3, 4 precisam limpar todos os times no final da temporada
    // Apenas quem se classificar novamente participa na próxima temporada
    const typesToClear = [0, 1, 3, 4];
    
    // Identificar competições que precisam ter times limpos
    const competitionsToClear = this.competitions.filter(c => typesToClear.includes(c.type));
    const competitionIdsToClear = competitionsToClear.map(c => c.id);
    
    // Identificar stages dessas competições
    const stagesToClear = [];
    this.competitionStages.forEach(stage => {
        const stageCompIds = stage.competitionId.split(',').map(id => id.trim());
        if (stageCompIds.some(compId => competitionIdsToClear.includes(compId))) {
            stagesToClear.push(stage.id);
        }
    });
    
    // Remover as competições e stages de TODOS os times
    this.clubs.forEach(club => {
        // Remover competições dos tipos 0, 1, 3, 4
        club.competitions = club.competitions.filter(compId =>
            !competitionIdsToClear.includes(compId)
        );
        
        // Remover stages dessas competições
        club.stages = club.stages.filter(stageId =>
            !stagesToClear.includes(stageId)
        );
    });
},

    async simulate() {
        const homeId = document.getElementById("teamHome").value;
        const awayId = document.getElementById("teamAway").value;
        if (!homeId || !awayId) {
            alert("Por favor, selecione ambos os times.");
            return;
        }
        
        const homeClub = this.getClub(homeId);
        const awayClub = this.getClub(awayId);
        if (!homeClub || !awayClub) {
            return;
        }
        
        const withOriginalStats = club => ({ ...club, rating: club.originalRating });
        const home = withOriginalStats(homeClub);
        const away = withOriginalStats(awayClub);
        
        await this.simulateMatch(home, away);
    },

    async simulateMatch(home, away) {
        const homeExpected = this.calcExpectedGoals(home.rating, away.rating, true);
        const awayExpected = this.calcExpectedGoals(away.rating, home.rating, false);
        const homeScore = this.poisson(homeExpected);
        const awayScore = this.poisson(awayExpected);
        const [logoHome, logoAway] = await Promise.all([
            this.loadLogo(home.id), 
            this.loadLogo(away.id)
        ]);
        this.displayMatchResult(home, away, homeScore, awayScore, logoHome, logoAway, "result");
    },

    displayMatchResult(home, away, homeScore, awayScore, logoHome, logoAway, container) {
        const el = container instanceof HTMLElement ? container : document.getElementById(container);
        el.innerHTML = `
<div class="match">
    <div class="team-row">
        <div class="team-home">
            <span class="team-name">${home.name} </span>
            ${logoHome ? `
            <div class="logo-wrap">
                <img src="${logoHome}" alt="${home.name}" class="logo">
            </div>` : ''}
        </div>
        <span class="score">${homeScore} <span class="x">-</span> ${awayScore}</span>
        <div class="team-away">
            ${logoAway ? `
            <div class="logo-wrap">
                <img src="${logoAway}" alt="${away.name}" class="logo">
            </div>` : ''}
            <span class="team-name"> ${away.name}</span>
        </div>
    </div>
</div>
        `;
    },

    // =========================================================
    // WEEKLY SIMULATION SYSTEM
    // =========================================================

    getSeasonWindow(type) {
        switch (type) {
            case 5: return { start: 1, end: 13 };    // Estadual
            case 4: return { start: 2, end: 3 };      // Supercopa
            case 2: return { start: 9, end: 38 };     // Campeonato Nacional
            case 3: return { start: 10, end: 38 };    // Copa Nacional
            case 0: return { start: 12, end: 38 };    // Continental
            case 1: return { start: 39, end: 42 };    // Intercontinental
            default: return { start: 1, end: 42 };
        }
    },

    initializeWeeklySeason() {
        this.invalidatePlayerCache();
        this.processYouthUpgrades();
        this.revealYouthPlayers();
        
        this.clubs.forEach(club => {
            const clubPlayers = this.players.filter(p => p.clubId === club.id && !p.retired);
            if (clubPlayers.length < 20) {
                this.generateFicticiousPlayers(club.id, 20 - clubPlayers.length);
            }
        });
        this.invalidatePlayerCache();

        const allCompetitions = [...this.competitions].sort((a, b) => {
            if (a.countryId !== b.countryId) return a.countryId.localeCompare(b.countryId);
            return a.importanceOrder - b.importanceOrder;
        });

        if (allCompetitions.length === 0) {
            return null;
        }

        const seasonResult = {
            season: this.seasonHistory.length + 1,
            competitions: [],
            year: new Date().getFullYear() + this.seasonHistory.length
        };

        // Build competition → stages mapping
        const competitionStagesMap = new Map();
        allCompetitions.forEach(comp => {
            const stages = this.competitionStages.filter(s => {
                const compIds = s.competitionId.split(',').map(id => id.trim());
                return compIds.includes(comp.id);
            }).sort((a, b) => a.startingWeek - b.startingWeek || Number(a.id) - Number(b.id));
            competitionStagesMap.set(comp.id, stages);
        });

        // State tracking
        const stageSchedules = new Map();  // stageId → { stage, teams, schedule, standings, groups, playoffData, clubsStats, clubsStatsMap, roundsPlayed, totalRounds, type, competitionId }
        const stageWindows = new Map();    // stageId → { weekStart, weekEnd }
        const weeklyPlan = Array.from({ length: this.TOTAL_WEEKS + 1 }, () => []);
        const completedStages = new Set();
        const qualifiedTeams = new Map();
        const crossQualified = new Map();
        const sharedStageResults = new Map();
        const stageStatus = new Map();     // stageId → 'pending' | 'ready' | 'active' | 'completed'
        const competitionResults = new Map(); // competitionId → { competition, stages: [], championId }

        // Initialize competition results
        allCompetitions.forEach(comp => {
            competitionResults.set(comp.id, {
                competition: comp,
                stages: [],
                championId: null,
                type: comp.type
            });
        });

        // Inject nextSeasonInjections
        if (this.nextSeasonInjections.size > 0) {
            this.nextSeasonInjections.forEach((clubs, stageId) => {
                if (!crossQualified.has(stageId)) crossQualified.set(stageId, []);
                const list = crossQualified.get(stageId);
                clubs.forEach(club => {
                    if (!list.find(c => c.id === club.id)) list.push(club);
                });
            });
            this.nextSeasonInjections = new Map();
        }

        // Assign windows and prepare initial stages
        const processedStages = new Set();
        
        allCompetitions.forEach(comp => {
            const window = this.getSeasonWindow(comp.type);
            const stages = competitionStagesMap.get(comp.id) || [];
            
            if (stages.length === 0) return;

            // Distribute stages within the competition window
            const totalStages = stages.length;
            const windowSize = window.end - window.start + 1;

            stages.forEach((stage, idx) => {
                if (processedStages.has(stage.id)) {
                    // Stage shared with another competition - already processed
                    return;
                }
                processedStages.add(stage.id);

                // Calculate this stage's window within the competition window
                const stageStart = window.start + Math.floor(idx * windowSize / totalStages);
                const stageEnd = window.start + Math.floor((idx + 1) * windowSize / totalStages) - 1;
                stageWindows.set(stage.id, { weekStart: Math.max(1, stageStart), weekEnd: Math.max(stageStart + 1, stageEnd) });

                // Check if this stage has initial teams
                const assignedTeams = this.clubs.filter(club =>
                    club.stages.includes(stage.id) && club.originalStages.includes(stage.id)
                );
                const extraTeams = crossQualified.get(stage.id) || [];

                if (assignedTeams.length > 0 || extraTeams.length > 0) {
                    // Combine all team sources
                    const unique = new Map();
                    [...assignedTeams, ...extraTeams].forEach(t => {
                        if (t && !unique.has(t.id)) unique.set(t.id, t);
                    });
                    const teams = Array.from(unique.values());

                    // Handle Supercopa fix
                    if (comp.type === 4 && teams.length < 2 && teams.length > 0) {
                        const sameCountryChamp = this.competitions.find(c => c.type === 2 && c.countryId === comp.countryId);
                        if (sameCountryChamp) {
                            const champStages = (competitionStagesMap.get(sameCountryChamp.id) || [])
                                .sort((a, b) => b.startingWeek - a.startingWeek);
                            const lastChampStage = champStages.find(s => s.isWinnerDecisionStage) || champStages[0];
                            if (lastChampStage && sharedStageResults.has(lastChampStage.id)) {
                                const champResult = sharedStageResults.get(lastChampStage.id);
                                const secondPlace = champResult.standings?.[1];
                                if (secondPlace) {
                                    const club = this.getClub(secondPlace.id);
                                    if (club && !teams.find(t => t.id === club.id)) teams.push(club);
                                }
                            }
                        }
                    }

                    if (teams.length >= 2) {
                        this.prepareStageSchedule(stage, teams, stageSchedules);
                        stageStatus.set(stage.id, 'ready');
                        this.distributeStageRounds(stage.id, stageSchedules, stageWindows, weeklyPlan);
                    } else {
                        stageStatus.set(stage.id, 'pending');
                    }
                } else {
                    stageStatus.set(stage.id, 'pending');
                }
            });
        });

        // Calculate actual TOTAL_WEEKS based on stage windows (dynamically expanded)
        let actualTotalWeeks = this.TOTAL_WEEKS;
        stageWindows.forEach(w => {
            if (w.weekEnd > actualTotalWeeks) actualTotalWeeks = w.weekEnd;
        });
        // Ensure weeklyPlan is large enough
        while (weeklyPlan.length <= actualTotalWeeks) {
            weeklyPlan.push([]);
        }

        this.seasonState = {
            currentWeek: 0,
            totalWeeks: actualTotalWeeks,
            stageSchedules,
            stageWindows,
            weeklyPlan,
            completedStages,
            qualifiedTeams,
            crossQualified,
            sharedStageResults,
            stageStatus,
            competitionResults,
            competitionStagesMap,
            allCompetitions,
            seasonResult,
            seasonComplete: false
        };

        this.seasonInProgress = true;
        return this.seasonState;
    },

    prepareStageSchedule(stage, teams, stageSchedules) {
        const clubsStats = teams.map(team => ({
            id: team.id,
            currentRating: team.rating,
            expectedGoalsFor: 0, expectedGoalsAgainst: 0,
            actualGoalsFor: 0, actualGoalsAgainst: 0,
            goals: 0, assists: 0, cleanSheets: 0
        }));
        const clubsStatsMap = new Map(clubsStats.map(s => [s.id, s]));

        const data = {
            stage, teams, clubsStats, clubsStatsMap,
            standings: [], schedule: [], groups: [],
            playoffBracket: [], playoffData: null,
            roundsPlayed: 0, totalRounds: 0, type: 'league'
        };

        if (stage.stageType === 1) {
            // Playoff - generate matchups
            const numLegs = stage.numLegs || 1;
            const allTeams = teams.filter(t => t && t.id).map(t => ({ ...t }));
            const shuffled = [...allTeams].sort(() => Math.random() - 0.5);
            if (shuffled.length % 2 !== 0) shuffled.pop();

            data.type = 'playoff';
            data.playoffMatchups = [];
            for (let i = 0; i < shuffled.length; i += 2) {
                data.playoffMatchups.push({ team1: shuffled[i], team2: shuffled[i + 1], numLegs });
            }
            data.totalRounds = 1;
        } else if (stage.stageType === 2) {
            // Pot League
            data.schedule = this.generatePotLeagueSchedule(teams);
            data.totalRounds = data.schedule.length;
            data.type = 'potLeague';
        } else if (stage.stageType === 3) {
            // Cross-group
            data.type = 'crossGroup';
            const numGroups = stage.numGroups ?? 2;
            const shuffled = [...teams];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }
            const groups = Array.from({ length: numGroups }, (_, i) => ({
                id: String.fromCharCode(65 + i), teams: []
            }));
            shuffled.forEach((t, i) => groups[i % numGroups].teams.push(t));
            
            const teamGroup = new Map();
            groups.forEach(g => g.teams.forEach(t => teamGroup.set(t.id, g.id)));
            
            // Generate cross-group schedule
            const schedule = [];
            let globalRound = 1;
            for (let g1 = 0; g1 < groups.length; g1++) {
                for (let g2 = g1 + 1; g2 < groups.length; g2++) {
                    let A = groups[g1].teams.map(t => t.id);
                    let B = groups[g2].teams.map(t => t.id);
                    const maxLen = Math.max(A.length, B.length);
                    while (A.length < maxLen) A.push(null);
                    while (B.length < maxLen) B.push(null);
                    let rotA = [...A], rotB = [...B];
                    for (let r = 0; r < maxLen; r++) {
                        const roundMatches = [];
                        const invertHome = r % 2 === 1;
                        for (let i = 0; i < maxLen; i++) {
                            const a = rotA[i], b = rotB[i];
                            if (!a || !b) continue;
                            const home = invertHome ? b : a;
                            const away = invertHome ? a : b;
                            roundMatches.push({
                                home, away, homeScore: 0, awayScore: 0, played: false,
                                round: globalRound,
                                homeGroup: teamGroup.get(home), awayGroup: teamGroup.get(away)
                            });
                        }
                        schedule.push(roundMatches);
                        globalRound++;
                        rotA = [rotA[0], ...rotA.slice(2), rotA[1]];
                        rotB = [rotB[rotB.length - 1], ...rotB.slice(0, rotB.length - 1)];
                    }
                }
            }
            data.schedule = schedule;
            data.groups = groups;
            data.teamGroup = teamGroup;
            data.totalRounds = schedule.length;
        } else if (stage.numGroups > 1) {
            // Regular groups
            data.type = 'group';
            const numGroups = stage.numGroups || 1;
            const numRounds = stage.numRounds || 2;
            const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
            const baseSize = Math.floor(shuffledTeams.length / numGroups);
            const remainder = shuffledTeams.length % numGroups;
            let startIndex = 0;
            const groups = [];
            let maxRounds = 0;

            for (let g = 0; g < numGroups; g++) {
                const groupSize = baseSize + (g < remainder ? 1 : 0);
                const groupTeams = shuffledTeams.slice(startIndex, startIndex + groupSize);
                startIndex += groupSize;
                if (groupTeams.length < 2) continue;
                const groupSchedule = this.generateLeagueSchedule(groupTeams, numRounds);
                if (groupSchedule.length > maxRounds) maxRounds = groupSchedule.length;
                groups.push({
                    id: String.fromCharCode(65 + g),
                    teams: groupTeams,
                    standings: [],
                    schedule: groupSchedule
                });
            }
            data.groups = groups;
            data.totalRounds = maxRounds;
        } else {
            // Regular league
            data.schedule = this.generateLeagueSchedule(teams, stage.numRounds || 2);
            data.totalRounds = data.schedule.length;
            data.type = 'league';
        }

        stageSchedules.set(stage.id, data);
    },

    distributeStageRounds(stageId, stageSchedules, stageWindows, weeklyPlan) {
        const data = stageSchedules.get(stageId);
        const window = stageWindows.get(stageId);
        if (!data || !window) return;

        const totalRounds = data.totalRounds;
        if (totalRounds === 0) return;

        // Ensure window is large enough: 1 round per week minimum
        const currentSize = window.weekEnd - window.weekStart + 1;
        if (totalRounds > currentSize) {
            window.weekEnd = window.weekStart + totalRounds - 1;
        }
        const windowSize = window.weekEnd - window.weekStart + 1;

        // Grow weeklyPlan if needed
        while (weeklyPlan.length <= window.weekEnd) {
            weeklyPlan.push([]);
        }

        for (let r = 0; r < totalRounds; r++) {
            const week = window.weekStart + Math.floor(r * windowSize / totalRounds);
            weeklyPlan[week].push({ stageId, roundIndex: r });
        }
    },

    playWeekMatches(week) {
        const state = this.seasonState;
        const tasks = state.weeklyPlan[week] || [];

        for (const { stageId, roundIndex } of tasks) {
            const data = state.stageSchedules.get(stageId);
            if (!data || state.completedStages.has(stageId)) continue;
            if (roundIndex < data.roundsPlayed) continue; // Already played

            // Initialize standings if first round
            if (data.roundsPlayed === 0) {
                if (data.type === 'league' || data.type === 'potLeague') {
                    this.initializeStandings(data.teams);
                    data.standingsRef = this.standings;
                    data.standingsMapRef = this.standingsMap;
                } else if (data.type === 'group') {
                    data.groups.forEach(g => {
                        this.initializeStandings(g.teams);
                        g.standingsRef = this.standings;
                        g.standingsMapRef = this.standingsMap;
                    });
                } else if (data.type === 'crossGroup') {
                    this.initializeStandings(data.teams);
                    data.standingsRef = this.standings;
                    data.standingsMapRef = this.standingsMap;
                }
            }

            if (data.type === 'playoff') {
                // Play all playoff matches at once
                const playoffResult = this.simulatePlayoff(data.teams, data.stage);
                data.playoffBracket = playoffResult.bracket;
                data.playoffData = playoffResult;
                data.standings = this.getPlayoffTeamsInOrder(playoffResult.bracket, playoffResult.winners);
                data.roundsPlayed = data.totalRounds;
            } else if (data.type === 'league' || data.type === 'potLeague') {
                this.standings = data.standingsRef;
                this.standingsMap = data.standingsMapRef;
                const roundMatches = data.schedule[roundIndex];
                if (roundMatches) {
                    for (const match of roundMatches) {
                        this.playMatch(match, data.clubsStats, data.clubsStatsMap);
                    }
                }
                data.roundsPlayed = roundIndex + 1;
                this.sortStandings();
                data.standings = JSON.parse(JSON.stringify(this.standings));
            } else if (data.type === 'group') {
                data.groups.forEach(group => {
                    this.standings = group.standingsRef;
                    this.standingsMap = group.standingsMapRef;
                    const roundMatches = group.schedule[roundIndex];
                    if (roundMatches) {
                        for (const match of roundMatches) {
                            this.playMatch(match, data.clubsStats, data.clubsStatsMap);
                        }
                    }
                    this.sortStandings();
                    group.standings = JSON.parse(JSON.stringify(this.standings));
                });
                data.roundsPlayed = roundIndex + 1;
                data.standings = this.consolidateGroupStandings(data.groups);
            } else if (data.type === 'crossGroup') {
                this.standings = data.standingsRef;
                this.standingsMap = data.standingsMapRef;
                const roundMatches = data.schedule[roundIndex];
                if (roundMatches) {
                    for (const match of roundMatches) {
                        this.playMatch(match, data.clubsStats, data.clubsStatsMap);
                    }
                }
                data.roundsPlayed = roundIndex + 1;
                this.sortStandings();
                const finalStandings = JSON.parse(JSON.stringify(this.standings));
                data.standings = finalStandings;
                // Update group standings
                data.groups.forEach(g => {
                    g.standings = finalStandings.filter(s => g.teams.some(t => t.id === s.id));
                    g.schedule = data.schedule.map(r => r.filter(m => g.teams.some(t => t.id === m.home || t.id === m.away)));
                    g.isCrossGroup = true;
                });
            }
        }
    },

    checkAndCompleteStages() {
        const state = this.seasonState;
        
        state.stageSchedules.forEach((data, stageId) => {
            if (state.completedStages.has(stageId)) return;
            if (data.roundsPlayed < data.totalRounds) return;

            // Stage complete!
            state.completedStages.add(stageId);

            // Build stageResult compatible with existing code
            const stageResult = {
                stage: data.stage,
                standings: data.standings || [],
                schedule: data.schedule || [],
                playoffBracket: data.playoffBracket || [],
                groups: data.groups || [],
                clubsStats: data.clubsStats || []
            };

            state.sharedStageResults.set(stageId, stageResult);

            // Update ratings
            this.updateRatingsFromStats(data.clubsStats);

            // Distribute awards
            if (stageResult.standings && stageResult.standings.length > 0) {
                this.distributeAwards(stageId, stageResult.standings);
            }

            // Add to competition results
            const stageCompIds = data.stage.competitionId.split(',').map(id => id.trim());
            stageCompIds.forEach(compId => {
                const compResult = state.competitionResults.get(compId);
                if (compResult) {
                    compResult.stages.push(stageResult);
                    
                    // Check for champion
                    if (data.stage.isWinnerDecisionStage) {
                        if (data.stage.stageType === 0 || data.stage.stageType === 2 || data.stage.stageType === 3) {
                            compResult.championId = stageResult.standings?.[0]?.id || null;
                        } else if (data.stage.stageType === 1 && stageResult.playoffBracket?.length > 0) {
                            const finalRound = stageResult.playoffBracket[stageResult.playoffBracket.length - 1];
                            if (finalRound?.matches?.length > 0) {
                                compResult.championId = finalRound.matches[0].winner?.id || null;
                            }
                        }
                        if (compResult.championId) {
                            this.addChampionship(compResult.championId, compId);
                        }
                    }
                }
            });

            // Process transitions
            const transitions = this.competitionStageTransitions.filter(t => t.stageIdFrom === stageId);
            
            for (const transition of transitions) {
                let teamsToTransfer = [];
                const teams = data.teams || [];

                if (transition.place === -1) {
                    teamsToTransfer = teams.map(t => this.getClub(t.id)).filter(Boolean);
                } else {
                    teamsToTransfer = this.getTeamsByPosition(
                        data.stage, transition.place, stageResult.standings,
                        stageResult.groups, stageResult.playoffBracket
                    ).map(t => this.getClub(t.id)).filter(Boolean);
                }

                if (teamsToTransfer.length > 0) {
                    if (!state.qualifiedTeams.has(transition.stageIdTo)) {
                        state.qualifiedTeams.set(transition.stageIdTo, []);
                    }
                    const currentTeams = state.qualifiedTeams.get(transition.stageIdTo);
                    teamsToTransfer.forEach(team => {
                        if (!currentTeams.find(t => t.id === team.id)) {
                            currentTeams.push(team);
                        }
                    });

                    // Type 106: cross-competition qualification (same season)
                    if (transition.type === 106) {
                        const targetStage = this.competitionStages.find(s => s.id === transition.stageIdTo);
                        if (targetStage) {
                            const targetCompIds = targetStage.competitionId.split(',').map(id => id.trim());
                            const isDifferent = !stageCompIds.some(id => targetCompIds.includes(id));
                            if (isDifferent) {
                                if (!state.crossQualified.has(transition.stageIdTo)) {
                                    state.crossQualified.set(transition.stageIdTo, []);
                                }
                                const globalList = state.crossQualified.get(transition.stageIdTo);
                                teamsToTransfer.forEach(team => {
                                    if (!globalList.find(t => t.id === team.id)) globalList.push(team);
                                });
                            }
                        }
                    }
                }
            }
        });
    },

    activatePendingStages() {
        const state = this.seasonState;
        let activated = false;

        state.stageStatus.forEach((status, stageId) => {
            if (status !== 'pending') return;
            if (state.completedStages.has(stageId)) return;
            if (state.stageSchedules.has(stageId)) return;

            // Check if teams are now available
            const stage = this.competitionStages.find(s => s.id === stageId);
            if (!stage) return;
const incomingTransitions = this.competitionStageTransitions.filter(t => t.stageIdTo === stageId);
const hasUncompletedFeeders = incomingTransitions.some(t => !state.completedStages.has(t.stageIdFrom));
if (hasUncompletedFeeders) return;


            const assignedTeams = this.clubs.filter(club =>
                club.stages.includes(stage.id) && club.originalStages.includes(stage.id)
            );
            const qualifiedFromTransitions = state.qualifiedTeams.get(stageId) || [];
            const extraTeams = state.crossQualified.get(stageId) || [];

            const unique = new Map();
            [...assignedTeams, ...qualifiedFromTransitions, ...extraTeams].forEach(t => {
                if (t && !unique.has(t.id)) unique.set(t.id, t);
            });
            const teams = Array.from(unique.values());

            if (teams.length >= 2) {
                // Handle Supercopa fix
                const stageCompIds = stage.competitionId.split(',').map(id => id.trim());
                stageCompIds.forEach(compId => {
                    const comp = this.competitions.find(c => c.id === compId);
                    if (comp && comp.type === 4 && teams.length < 2) {
                        const sameCountryChamp = this.competitions.find(c => c.type === 2 && c.countryId === comp.countryId);
                        if (sameCountryChamp) {
                            const champStages = (state.competitionStagesMap.get(sameCountryChamp.id) || [])
                                .sort((a, b) => b.startingWeek - a.startingWeek);
                            const lastChampStage = champStages.find(s => s.isWinnerDecisionStage) || champStages[0];
                            if (lastChampStage && state.sharedStageResults.has(lastChampStage.id)) {
                                const champResult = state.sharedStageResults.get(lastChampStage.id);
                                const secondPlace = champResult.standings?.[1];
                                if (secondPlace) {
                                    const club = this.getClub(secondPlace.id);
                                    if (club && !teams.find(t => t.id === club.id)) teams.push(club);
                                }
                            }
                        }
                    }
                });

                if (teams.length >= 2) {
                    this.prepareStageSchedule(stage, teams, state.stageSchedules);
                    state.stageStatus.set(stageId, 'ready');
                    
                    // Assign to remaining weeks
                    const window = state.stageWindows.get(stageId);
                    if (window) {
                        // Adjust window start to current week if we're past it
                        const adjustedStart = Math.max(window.weekStart, state.currentWeek + 1);
                        const adjustedWindow = { ...window, weekStart: adjustedStart };
                        state.stageWindows.set(stageId, adjustedWindow);
                    }
                    this.distributeStageRounds(stageId, state.stageSchedules, state.stageWindows, state.weeklyPlan);
                    // Update totalWeeks if this stage expanded beyond current limit
                    const newWindow = state.stageWindows.get(stageId);
                    if (newWindow && newWindow.weekEnd > state.totalWeeks) {
                        state.totalWeeks = newWindow.weekEnd;
                        while (state.weeklyPlan.length <= state.totalWeeks) {
                            state.weeklyPlan.push([]);
                        }
                    }
                    activated = true;
                }
            }
        });

        return activated;
    },

    finalizeSeasonWeekly() {
        const state = this.seasonState;

        // Build season result
        const seasonResult = state.seasonResult;
        state.competitionResults.forEach((compResult, compId) => {
            if (compResult.stages.length > 0) {
                seasonResult.competitions.push(compResult);
            }
        });

        if (seasonResult.competitions.length === 0) {
            return null;
        }

        // End-of-season processing
        this.resetContinentalQualifications();
        this.applyPromotionsAndRelegationsAllCountries(seasonResult);
        this.evolvePlayersEndOfSeason();
        this.runTransferWindow();
        this.invalidatePlayerCache();

        seasonResult.transfers = this.getTransferReport();
        seasonResult.rejectedOffers = this.getRejectedOffersReport();

        this.seasonHistory.push(seasonResult);
        document.getElementById('saveProgressBtn').style.display = 'inline-block';
        this.seasonInProgress = false;
        state.seasonComplete = true;

        return seasonResult;
    },

    updateWeekUI() {
        const state = this.seasonState;
        if (!state) return;

        const weekIndicator = document.getElementById('weekIndicator');
        if (weekIndicator) weekIndicator.style.display = 'block';

        const weekLabel = document.getElementById('weekLabel');
        if (weekLabel) weekLabel.textContent = `Semana ${state.currentWeek} / ${state.totalWeeks}`;

        const weekFill = document.getElementById('weekFill');
        if (weekFill) weekFill.style.width = `${(state.currentWeek / state.totalWeeks) * 100}%`;

        const weekStatus = document.getElementById('weekStatus');
        if (weekStatus) {
            const active = Array.from(state.stageStatus.values()).filter(s => s === 'ready').length;
            const completed = state.completedStages.size;
            weekStatus.textContent = `${completed} concluídas`;
        }

        // Show/hide buttons
        const advanceBtn = document.getElementById('advanceWeekBtn');
        const newSeasonBtn = document.getElementById('newSeasonBtn');
        const continueBtn = document.getElementById('simulateNextSeasonBtn');

        if (state.seasonComplete) {
            if (newSeasonBtn) newSeasonBtn.style.display = 'inline-block';
            if (continueBtn) continueBtn.style.display = 'inline-block';
        } else if (this.seasonInProgress) {
            if (advanceBtn) advanceBtn.style.display = 'inline-block';
            if (newSeasonBtn) newSeasonBtn.style.display = 'none';
        }
    },

    buildCurrentSeasonPreview() {
        const state = this.seasonState;
        if (!state) return null;

        const preview = {
            season: this.seasonHistory.length + 1,
            competitions: [],
            year: state.seasonResult.year,
            isPreview: true
        };

        // Add completed stages from competitionResults
        const addedStageIds = new Set();
        state.competitionResults.forEach((compResult, compId) => {
            if (compResult.stages.length > 0) {
                const cloned = {
                    competition: compResult.competition,
                    stages: [...compResult.stages],
                    championId: compResult.championId,
                    type: compResult.type
                };
                compResult.stages.forEach(s => addedStageIds.add(s.stage.id));
                preview.competitions.push(cloned);
            }
        });

        // Add in-progress stages (not yet completed but have rounds played)
        state.stageSchedules.forEach((data, stageId) => {
            if (addedStageIds.has(stageId)) return;
            if (data.roundsPlayed === 0) return;

            const partialResult = {
                stage: data.stage,
                standings: data.standings || [],
                schedule: data.schedule || [],
                playoffBracket: data.playoffBracket || [],
                groups: data.groups || [],
                clubsStats: data.clubsStats || []
            };

            const stageCompIds = data.stage.competitionId.split(',').map(id => id.trim());
            stageCompIds.forEach(compId => {
                let compEntry = preview.competitions.find(c => c.competition.id === compId);
                if (!compEntry) {
                    const comp = state.allCompetitions.find(c => c.id === compId);
                    if (comp) {
                        compEntry = {
                            competition: comp,
                            stages: [],
                            championId: null,
                            type: comp.type
                        };
                        preview.competitions.push(compEntry);
                    }
                }
                if (compEntry && !compEntry.stages.find(s => s.stage.id === stageId)) {
                    compEntry.stages.push(partialResult);
                }
            });
        });

        return preview;
    },

    async advanceWeekUI() {
        const button = document.getElementById("advanceWeekBtn");

        try {
            // Initialize season if not started
            if (!this.seasonInProgress || !this.seasonState) {
                this.currentSeason = this.seasonHistory.length + 1;
                this.initializeWeeklySeason();
                this.updateWeekUI();
            }

            const state = this.seasonState;
            if (state.seasonComplete) return;

            state.currentWeek++;

            // Play matches for this week
            this.playWeekMatches(state.currentWeek);

            // Check for completed stages
            this.checkAndCompleteStages();

            // Try to activate pending stages
            this.activatePendingStages();

            this.updateWeekUI();

            // Show progress
            const progressContainer = document.getElementById("seasonProgress");
            if (progressContainer) {
                const tasks = state.weeklyPlan[state.currentWeek] || [];
                const stageNames = [...new Set(tasks.map(t => {
                    const d = state.stageSchedules.get(t.stageId);
                    return d?.stage?.name || '';
                }).filter(Boolean))];
                
                progressContainer.innerHTML = `<span style="color:#4fc3f7;font-weight:600;">Semana ${state.currentWeek}: ${stageNames.length > 0 ? stageNames.join(', ') : 'Sem jogos'}</span>`;
                progressContainer.style.display = 'block';
            }

            // Build preview and show Visualizar Resultados section (wrapped in try-catch to never break season flow)
            try {
                const preview = this.buildCurrentSeasonPreview();
                if (preview && preview.competitions.length > 0) {
                    this.currentSeasonPreview = preview;
                    this.updateSeasonSelectsWithPreview();
                    const seasonSelector = document.getElementById("viewSeason");
                    if (seasonSelector) {
                        seasonSelector.value = 'current';
                        this.viewSeason('current');
                    }
                }
            } catch (previewErr) {
            }

            // Check if season is over
            if (state.currentWeek >= state.totalWeeks) {
                // Check if there are still unplayed rounds
                let hasUnplayed = false;
                state.stageSchedules.forEach((data, stageId) => {
                    if (!state.completedStages.has(stageId) && data.roundsPlayed < data.totalRounds) {
                        hasUnplayed = true;
                    }
                });

                if (!hasUnplayed || state.currentWeek >= state.totalWeeks + 5) {
                    this.currentSeasonPreview = null;
                    this.finalizeSeasonWeekly();
                    this.updateSeasonSelects();
                    const seasonSelector = document.getElementById("viewSeason");
                    seasonSelector.value = this.seasonHistory.length;
                    this.viewSeason(this.seasonHistory.length);
                    this.updateWeekUI();

                    if (progressContainer) {
                        progressContainer.innerHTML = `<span style="color:#4ade80;font-weight:600;">✅ Temporada ${this.seasonHistory.length} concluída!</span>`;
                    }
                }
            }

            await new Promise(r => setTimeout(r, 10));
        } finally {
            button.disabled = false;
        }
    },

    async startNewSeasonUI() {
        if (this.seasonInProgress && !this.seasonState?.seasonComplete) {
            alert("Complete todos os jogos da temporada atual antes de iniciar uma nova.");
            return;
        }

        this.seasonState = null;
        this.seasonInProgress = false;
        this.currentSeasonPreview = null;

        // Hide new season button, show advance
        const newSeasonBtn = document.getElementById('newSeasonBtn');
        if (newSeasonBtn) newSeasonBtn.style.display = 'none';

        // Initialize and show week 0
        this.currentSeason = this.seasonHistory.length + 1;
        this.initializeWeeklySeason();
        this.updateWeekUI();

        const progressContainer = document.getElementById("seasonProgress");
        if (progressContainer) {
            progressContainer.innerHTML = `<span style="color:#4fc3f7;font-weight:600;">Temporada ${this.currentSeason} iniciada. Use Avançar Semana ou Continuar.</span>`;
            progressContainer.style.display = 'block';
        }
    },

    async simulateNextSeason() {
        const button = document.getElementById("simulateNextSeasonBtn");
        if (button.disabled) return;
        button.disabled = true;
        const originalText = button.textContent;

        try {
            // If a season is already in progress (partially advanced), continue it
            // Otherwise start a new one
            if (!this.seasonInProgress || !this.seasonState || this.seasonState.seasonComplete) {
                this.seasonState = null;
                this.seasonInProgress = false;
                this.currentSeasonPreview = null;
                this.currentSeason = this.seasonHistory.length + 1;
                this.initializeWeeklySeason();
            }

            const state = this.seasonState;
            button.textContent = `Simulando...`;

            // Run all remaining weeks
            while (state.currentWeek < state.totalWeeks) {
                state.currentWeek++;
                this.playWeekMatches(state.currentWeek);
                this.checkAndCompleteStages();
                this.activatePendingStages();

                // Yield every 5 weeks for UI
                if (state.currentWeek % 5 === 0) {
                    button.textContent = `Semana ${state.currentWeek}/${state.totalWeeks}`;
                    this.updateWeekUI();
                    await new Promise(r => setTimeout(r, 0));
                }
            }

            // Play any remaining unplayed matches (extra weeks)
            let extraWeeks = 0;
            while (extraWeeks < 10) {
                let hasUnplayed = false;
                state.stageSchedules.forEach((data, stageId) => {
                    if (!state.completedStages.has(stageId) && data.roundsPlayed < data.totalRounds) {
                        hasUnplayed = true;
                    }
                });
                if (!hasUnplayed) break;
                
                state.currentWeek++;
                extraWeeks++;
                // Play any remaining rounds
                state.stageSchedules.forEach((data, stageId) => {
                    if (state.completedStages.has(stageId)) return;
                    while (data.roundsPlayed < data.totalRounds) {
                        const roundIndex = data.roundsPlayed;
                        // Create a temporary week plan entry
                        const tempTasks = [{ stageId, roundIndex }];
                        for (const task of tempTasks) {
                            const td = state.stageSchedules.get(task.stageId);
                            if (!td) continue;
                            
                            if (td.roundsPlayed === 0) {
                                if (td.type === 'league' || td.type === 'potLeague') {
                                    this.initializeStandings(td.teams);
                                    td.standingsRef = this.standings;
                                    td.standingsMapRef = this.standingsMap;
                                } else if (td.type === 'group') {
                                    td.groups.forEach(g => {
                                        this.initializeStandings(g.teams);
                                        g.standingsRef = this.standings;
                                        g.standingsMapRef = this.standingsMap;
                                    });
                                } else if (td.type === 'crossGroup') {
                                    this.initializeStandings(td.teams);
                                    td.standingsRef = this.standings;
                                    td.standingsMapRef = this.standingsMap;
                                }
                            }

                            if (td.type === 'playoff') {
                                const playoffResult = this.simulatePlayoff(td.teams, td.stage);
                                td.playoffBracket = playoffResult.bracket;
                                td.playoffData = playoffResult;
                                td.standings = this.getPlayoffTeamsInOrder(playoffResult.bracket, playoffResult.winners);
                                td.roundsPlayed = td.totalRounds;
                            } else if (td.type === 'league' || td.type === 'potLeague') {
                                this.standings = td.standingsRef;
                                this.standingsMap = td.standingsMapRef;
                                const rm = td.schedule[task.roundIndex];
                                if (rm) rm.forEach(m => this.playMatch(m, td.clubsStats, td.clubsStatsMap));
                                td.roundsPlayed = task.roundIndex + 1;
                                this.sortStandings();
                                td.standings = JSON.parse(JSON.stringify(this.standings));
                            } else if (td.type === 'group') {
                                td.groups.forEach(group => {
                                    this.standings = group.standingsRef;
                                    this.standingsMap = group.standingsMapRef;
                                    const rm = group.schedule[task.roundIndex];
                                    if (rm) rm.forEach(m => this.playMatch(m, td.clubsStats, td.clubsStatsMap));
                                    this.sortStandings();
                                    group.standings = JSON.parse(JSON.stringify(this.standings));
                                });
                                td.roundsPlayed = task.roundIndex + 1;
                                td.standings = this.consolidateGroupStandings(td.groups);
                            } else if (td.type === 'crossGroup') {
                                this.standings = td.standingsRef;
                                this.standingsMap = td.standingsMapRef;
                                const rm = td.schedule[task.roundIndex];
                                if (rm) rm.forEach(m => this.playMatch(m, td.clubsStats, td.clubsStatsMap));
                                td.roundsPlayed = task.roundIndex + 1;
                                this.sortStandings();
                                td.standings = JSON.parse(JSON.stringify(this.standings));
                                td.groups.forEach(g => {
                                    g.standings = td.standings.filter(s => g.teams.some(t => t.id === s.id));
                                    g.schedule = td.schedule.map(r => r.filter(m => g.teams.some(t => t.id === m.home || t.id === m.away)));
                                    g.isCrossGroup = true;
                                });
                            }
                        }
                        break;
                    }
                });
                this.checkAndCompleteStages();
                this.activatePendingStages();
            }

            const seasonResult = this.finalizeSeasonWeekly();
            if (seasonResult) {
                // Reset state so advanceWeekUI can start a new season
                this.seasonState = null;
                this.seasonInProgress = false;
                this.currentSeasonPreview = null;

                this.updateSeasonSelects();
                const seasonSelector = document.getElementById("viewSeason");
                seasonSelector.value = this.seasonHistory.length;
                this.viewSeason(this.seasonHistory.length);
                this.updateWeekUI();

                const progressContainer = document.getElementById("seasonProgress");
                if (progressContainer) {
                    progressContainer.style.display = 'block';
                }
            }
        } catch (error) {
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    },

    updateSeasonSelects() {
        const seasonSelector = document.getElementById("viewSeason"); 
        seasonSelector.innerHTML = '';
        
        this.seasonHistory.forEach((s, i) => { 
            const option = document.createElement("option");
            option.value = i + 1; 
            option.textContent = `Temporada ${i + 1}`; 
            seasonSelector.appendChild(option); 
        });
        
        seasonSelector.disabled = this.seasonHistory.length === 0; 
        document.getElementById("seasonSelector").style.display = this.seasonHistory.length > 0 ? 'block' : 'none';
        document.getElementById("viewSection").style.display = this.seasonHistory.length > 0 ? 'block' : 'none';
    },

    updateSeasonSelectsWithPreview() {
        const seasonSelector = document.getElementById("viewSeason"); 
        seasonSelector.innerHTML = '';
        
        this.seasonHistory.forEach((s, i) => { 
            const option = document.createElement("option");
            option.value = i + 1; 
            option.textContent = `Temporada ${i + 1}`; 
            seasonSelector.appendChild(option); 
        });
        
        // Add current in-progress season
        if (this.currentSeasonPreview) {
            const option = document.createElement("option");
            option.value = 'current';
            option.textContent = `Temporada ${this.seasonHistory.length + 1} (em andamento)`;
            seasonSelector.appendChild(option);
        }
        
        seasonSelector.disabled = false;
        document.getElementById("seasonSelector").style.display = 'block';
        document.getElementById("viewSection").style.display = 'block';
    },

// Mapeamento de tipos de competição
competitionTypeNames: {
    0: 'Continental',
    1: 'Intercontinental', 
    2: 'Campeonato',
    3: 'Copa Nacional',
    4: 'Supercopa',
    5: 'Campeonato Estadual'
},

    viewSeason(seasonNumber = null) {
        const selector = document.getElementById("viewSeason"); 
        const seasonValue = seasonNumber || selector.value;
        
        let seasonData;
        let season;
        
        // Handle in-progress season preview
        if (seasonValue === 'current') {
            seasonData = this.currentSeasonPreview;
            season = this.seasonHistory.length + 1;
        } else {
            season = parseInt(seasonValue);
            if (!season || isNaN(season) || season < 1 || season > this.seasonHistory.length) {
                document.getElementById("seasonResults").innerHTML = "<p>Selecione uma temporada válida</p>";
                return;
            }
            seasonData = this.seasonHistory[season - 1];
        }
        
        if (!seasonData || !seasonData.competitions || seasonData.competitions.length === 0) {
            document.getElementById("seasonResults").innerHTML = "<p>Nenhum dado disponível para esta temporada</p>";
            return;
        }
        
        this.currentSeason = season;
        
        // Preencher select de países com os países que têm competições nesta temporada
        this.updateViewCountrySelect(seasonData);
        
        // Preencher select de tipos de competição
        this.updateViewCompetitionTypeSelect(seasonData);
        
        // Mostrar botão de transferências se houver transferências ou ofertas rejeitadas
        const transfersBtn = document.getElementById("viewTransfersBtn");
        const hasTransfers = seasonData.transfers && seasonData.transfers.length > 0;
        const hasRejected = seasonData.rejectedOffers && seasonData.rejectedOffers.length > 0;
        if (hasTransfers || hasRejected) {
            transfersBtn.style.display = 'inline-block';
        } else {
            transfersBtn.style.display = 'none';
        }
        
        this.viewCompetitionsByFilters();
    },

    updateViewCountrySelect(seasonData) {
        const countrySelect = document.getElementById("viewCountry");
        const currentValue = countrySelect.value;
        
        // Pegar todos os países únicos das competições da temporada
        const countryIds = [...new Set(seasonData.competitions.map(c => c.competition.countryId))];
        const countriesInSeason = this.countries
            .filter(c => countryIds.includes(c.id))
            .sort((a, b) => a.name.localeCompare(b.name));
        
        countrySelect.innerHTML = '<option value="" disabled selected>Selecione o País</option>';
        
        countriesInSeason.forEach(country => {
            const option = document.createElement("option");
            option.value = country.id;
            option.textContent = country.name;
            countrySelect.appendChild(option);
        });
        
        // Manter a seleção anterior se ainda for válida
        if (currentValue && countryIds.includes(currentValue)) {
            countrySelect.value = currentValue;
        } else if (countriesInSeason.length > 0) {
            countrySelect.value = countriesInSeason[0].id;
        }
        
        document.getElementById("viewCountrySelector").style.display = 'block';
    },

    getSeasonData(season) {
        if (season === undefined || season === null) season = this.currentSeason;
        // If current season matches the preview, return preview
        if (this.currentSeasonPreview && season === this.seasonHistory.length + 1) {
            return this.currentSeasonPreview;
        }
        return this.seasonHistory[season - 1] || null;
    },

    onViewCountryChange() {
        // Quando mudar o país, atualizar os tipos disponíveis e visualização
        const seasonData = this.getSeasonData();
        if (seasonData) {
            this.updateViewCompetitionTypeSelect(seasonData);
            this.viewCompetitionsByFilters();
        }
    },

    onViewCompetitionTypeChange() {
        // Quando mudar o tipo, atualizar as competições disponíveis
        this.viewCompetitionsByFilters();
    },

    updateViewCompetitionTypeSelect(seasonData) {
        const typeSelect = document.getElementById("viewCompetitionType");
        const countryId = document.getElementById("viewCountry").value;
        const currentValue = typeSelect.value;
        
        // Filtrar competições pelo país selecionado
        const countryCompetitions = countryId 
            ? seasonData.competitions.filter(c => c.competition.countryId === countryId)
            : seasonData.competitions;
        
        // Pegar todos os tipos únicos das competições filtradas
        const types = [...new Set(countryCompetitions.map(c => c.competition.type))].sort((a, b) => a - b);
        
        typeSelect.innerHTML = '<option value="" disabled selected>Selecione o Tipo</option>';
        
        types.forEach(type => {
            const option = document.createElement("option");
            option.value = type;
            option.textContent = this.competitionTypeNames[type] || `Tipo ${type}`;
            typeSelect.appendChild(option);
        });
        
        // Manter a seleção anterior se ainda for válida
        if (currentValue && types.includes(parseInt(currentValue))) {
            typeSelect.value = currentValue;
        } else if (types.length > 0) {
            typeSelect.value = types[0];
        }
        
        document.getElementById("competitionTypeSelector").style.display = 'block';
    },

    viewCompetitionsByFilters() {
        const seasonData = this.getSeasonData();
        if (!seasonData) return;
        
        const viewCountryId = document.getElementById("viewCountry").value;
        const viewType = document.getElementById("viewCompetitionType").value;
        
        // Filtrar competições pelo país e tipo selecionados
        let filteredCompetitions = seasonData.competitions;
        
        if (viewCountryId) {
            filteredCompetitions = filteredCompetitions.filter(c => c.competition.countryId === viewCountryId);
        }
        
        if (viewType !== "" && viewType !== null) {
            filteredCompetitions = filteredCompetitions.filter(c => c.competition.type === parseInt(viewType));
        }
        
        this.currentDivisions = filteredCompetitions.map(c => c.competition)
            .sort((a, b) => a.importanceOrder - b.importanceOrder);
        this.currentDivisionIndex = 0;
        
        this.updateCompetitionSelectFiltered(filteredCompetitions);
        document.getElementById("seasonDivisionSelector").style.display = 'block';
        
        // Auto-selecionar primeira competição se houver
        const competitionSelect = document.getElementById("viewCompetition");
        if (competitionSelect.options.length > 1) {
            competitionSelect.selectedIndex = 1;
            this.viewCompetition();
        }
    },

    updateCompetitionSelectFiltered(filteredCompetitions) {
        const competitionSelect = document.getElementById("viewCompetition");
        competitionSelect.innerHTML = '<option value="" disabled selected>Selecione a Competição</option>';
        
        // Ordenar por importanceOrder
        const sortedCompetitions = filteredCompetitions.sort((a, b) => 
            a.competition.importanceOrder - b.competition.importanceOrder
        );
        
        sortedCompetitions.forEach(compData => {
            const option = document.createElement("option");
            option.value = compData.competition.id;
            option.textContent = `${compData.competition.name}`;
            competitionSelect.appendChild(option);
        });
        
        document.getElementById("competitionSelector").style.display = 'block';
        this.hideAllViewSelectors();
    },


    hideAllViewSelectors() {
        document.getElementById("roundSelector").style.display = 'none';
        document.getElementById("groupSelector").style.display = 'none';
        document.getElementById("viewPlayoffBtn").style.display = 'none';
        document.getElementById("seasonTransfers").style.display = 'none';
        const transfersBtn = document.getElementById("viewTransfersBtn");
        if (transfersBtn) transfersBtn.innerHTML = 'Ver Transferências';
    },

    viewCompetition() {
        const competitionId = document.getElementById("viewCompetition").value;
        if (!competitionId) return;
        
        const seasonData = this.getSeasonData();
        if (!seasonData) return;
        const competitionData = seasonData.competitions.find(c => c.competition.id === competitionId);
        if (!competitionData) return;
        
        this.currentCompetition = competitionData;
        this.updateStageSelect(competitionData);
        this.viewStage();
    },

    updateStageSelect(competitionData) {
        const stageSelect = document.getElementById("viewStage");
        stageSelect.innerHTML = '<option value="" disabled selected>Selecione a Fase</option>';
        
        competitionData.stages.forEach(stageData => {
            const option = document.createElement("option");
            option.value = stageData.stage.id;
            option.textContent = stageData.stage.name;
            stageSelect.appendChild(option);
        });
        
        document.getElementById("stageSelector").style.display = 'block';
    },

    async viewStage() {
        const stageId = document.getElementById("viewStage").value;
        if (!stageId || !this.currentCompetition) return;
        
        const stageData = this.currentCompetition.stages.find(s => s.stage.id === stageId);
        if (!stageData) return;
        
        this.currentStage = stageData;
        
        const seasonInfo = document.getElementById("seasonInfo");
        seasonInfo.innerHTML = `
            <h3>${this.currentCompetition.competition.name} - ${stageData.stage.name}</h3>
            <p><strong>Temporada ${this.currentSeason}</strong> | ${this.currentCompetition.championId ? 
                `Campeão: ${this.getClub(this.currentCompetition.championId)?.name}` : 'Campeão não definido'}</p>
        `;
        
        this.hideAllViewSelectors();
        
        if (stageData.stage.stageType === 1) {
            await this.viewKnockoutStage(stageData);
        } else if (stageData.groups && stageData.groups.length > 0) {
            await this.viewGroupStage(stageData);
        } else {
            await this.viewLeagueStage(stageData);
        }
    },

    async viewKnockoutStage(stageData) {
        this.playoffBracket = stageData.playoffBracket || [];
        await this.displayPlayoffBracket();
        document.getElementById("playoffBracket").style.display = 'block';
        document.getElementById("seasonStandings").style.display = 'none';
        document.getElementById("seasonMatches").style.display = 'none';
    },

    async viewGroupStage(stageData) {
        this.currentGroups = stageData.groups || [];
        this.currentGroupIndex = 0;
        this.standings = stageData.standings || [];
        this.schedule = stageData.schedule || [];
        
        document.getElementById("groupSelector").style.display = 'block';
        document.getElementById("roundSelector").style.display = 'block';
        document.getElementById("viewPlayoffBtn").style.display = 'none';
        
        this.updateGroupDisplay();
        this.updateRoundSelect();
        
        await this.displayStandings("seasonStandings");
        await this.displayRoundMatches(1, "seasonMatches");
        
        document.getElementById("seasonStandings").style.display = 'block';
        document.getElementById("seasonMatches").style.display = 'block';
        document.getElementById("playoffBracket").style.display = 'none';
    },

    async viewLeagueStage(stageData) {
        this.standings = stageData.standings || [];
        this.schedule = stageData.schedule || [];
        this.currentGroups = [];
        
        document.getElementById("roundSelector").style.display = 'block';
        document.getElementById("viewPlayoffBtn").style.display = 'none';
        document.getElementById("groupSelector").style.display = 'none';
        
        this.updateRoundSelect();
        
        await this.displayStandings("seasonStandings");
        await this.displayRoundMatches(1, "seasonMatches");
        
        document.getElementById("seasonStandings").style.display = 'block';
        document.getElementById("seasonMatches").style.display = 'block';
        document.getElementById("playoffBracket").style.display = 'none';
    },

    updateRoundSelect() {
        const roundSelector = document.getElementById("viewRound");
        roundSelector.innerHTML = '';
        
        // Para grupos, pega o máximo de rodadas entre todos os grupos
        let maxRounds = 0;
        if (this.currentGroups && this.currentGroups.length > 0) {
            this.currentGroups.forEach(group => {
                if (group.schedule && group.schedule.length > maxRounds) {
                    maxRounds = group.schedule.length;
                }
            });
        } else if (this.schedule && this.schedule.length > 0) {
            maxRounds = this.schedule.length;
        }
        
        if (maxRounds > 0) {
            for (let i = 1; i <= maxRounds; i++) {
                const option = document.createElement("option");
                option.value = i;
                option.textContent = `Rodada ${i}`;
                roundSelector.appendChild(option);
            }
            document.getElementById("roundSelector").style.display = 'block';
        } else {
            document.getElementById("roundSelector").style.display = 'none';
        }
    },

    async viewRound() { 
        const round = parseInt(document.getElementById("viewRound").value); 
        if (!round) return; 
        await this.displayStandingsUpToRound(round);
        await this.displayRoundMatches(round, "seasonMatches"); 
    },
    
    async displayStandingsUpToRound(round) {
        if (this.currentGroups.length > 0) {
            await this.displayGroupStandingsUpToRound(round);
        } else {
            await this.displayLeagueStandingsUpToRound(round);
        }
    },

    changeDivision(direction) {
        const newIndex = this.currentDivisionIndex + direction;
        if (newIndex >= 0 && newIndex < this.currentDivisions.length) { 
            this.currentDivisionIndex = newIndex; 
            this.viewSeason(); 
        }
    },

    changeGroup(direction) {
        if (this.currentGroups.length === 0) return;
        
        const newIndex = this.currentGroupIndex + direction;
        if (newIndex >= 0 && newIndex < this.currentGroups.length) {
            this.currentGroupIndex = newIndex;
            this.updateGroupDisplay();
            this.displayStandings("seasonStandings");
        }
    },

    updateGroupDisplay() {
        const display = document.getElementById("groupDisplay");
        if (this.currentGroups.length > 0) {
            const currentGroup = this.currentGroups[this.currentGroupIndex];
            display.textContent = `Grupo ${currentGroup.id}`;
        }
    },

    togglePlayoffView() {
        const standings = document.getElementById("seasonStandings");
        const matches = document.getElementById("seasonMatches");
        const playoff = document.getElementById("playoffBracket");
        const button = document.getElementById("viewPlayoffBtn");
        
        if (playoff.style.display === "none") {
            standings.style.display = "none";
            matches.style.display = "none";
            playoff.style.display = "block";
            button.textContent = "Ver Classificação";
        } else {
            standings.style.display = "block";
            matches.style.display = "block";
            playoff.style.display = "none";
            button.textContent = "Ver Playoff";
        }
    },

    async toggleTransfersView() {
        const standings = document.getElementById("seasonStandings");
        const matches = document.getElementById("seasonMatches");
        const transfers = document.getElementById("seasonTransfers");
        const button = document.getElementById("viewTransfersBtn");
        const playoff = document.getElementById("playoffBracket");
        
        if (transfers.style.display === "none") {
            standings.style.display = "none";
            matches.style.display = "none";
            playoff.style.display = "none";
            transfers.style.display = "block";
            button.innerHTML = 'Ver Tabela';
            await this.displayTransfers();
        } else {
            standings.style.display = "block";
            matches.style.display = "block";
            transfers.style.display = "none";
            button.innerHTML = 'Ver Transferências';
        }
    },

    async displayTransfers() {
        const container = document.getElementById("seasonTransfers");
        if (!container) return;
        
        const seasonData = this.getSeasonData();
        const hasTransfers = seasonData?.transfers?.length > 0;
        const hasRejected = seasonData?.rejectedOffers?.length > 0;
        
        if (!hasTransfers && !hasRejected) {
            container.innerHTML = `  
            <div class="section-card">  
                <div class="section-header">  
                    <h2>Transferências - T${this.currentSeason}</h2>  
                </div>  
                <p style="text-align: center; color: #888; padding: 10px;">Nenhuma transferência.</p>  
            </div>  
        `;
            return;
        }
        
        // Carregar todos os logos e bandeiras de uma vez  
        const allClubIds = new Set();
        const allCountryIds = new Set();
        if (seasonData.transfers) {
            seasonData.transfers.forEach(t => {
                if (t.fromId) allClubIds.add(t.fromId);
                if (t.toId) allClubIds.add(t.toId);
                if (t.playerCountryId) allCountryIds.add(t.playerCountryId);
            });
        }
        if (seasonData.rejectedOffers) {
            seasonData.rejectedOffers.forEach(t => {
                if (t.fromId) allClubIds.add(t.fromId);
                if (t.toId) allClubIds.add(t.toId);
                if (t.playerCountryId) allCountryIds.add(t.playerCountryId);
            });
        }
        
        const [logoEntries, flagEntries] = await Promise.all([
            Promise.all(Array.from(allClubIds).map(async id => [id, await this.loadLogo(id)])),
            Promise.all(Array.from(allCountryIds).map(async id => [id, await this.loadFlag(id)]))
        ]);
        const logoMap = new Map(logoEntries);
        const flagMap = new Map(flagEntries);
        
        // Transferências concluídas  
        let transfersHtml = '';
        if (hasTransfers) {
            seasonData.transfers.forEach(transfer => {
                const fromLogo = logoMap.get(transfer.fromId) || '';
                const toLogo = logoMap.get(transfer.toId) || '';
                const playerFlag = flagMap.get(transfer.playerCountryId) || '';
                
                transfersHtml += `  
                <div style="display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid #e8e8e8; font-size: 13px; background: #f8fff8;">  
    ${playerFlag ? `<img src="${playerFlag}" alt="" class="flag-icon">` : ''}${transfer.player}
</span>
                    ${fromLogo ? `<img src="${fromLogo}" alt="" style="width: 20px; height: 20px; object-fit: contain;">` : '<span style="width:20px;"></span>'}  
                    ${toLogo ? `<img src="${toLogo}" alt="" style="width: 20px; height: 20px; object-fit: contain;">` : '<span style="width:20px;"></span>'}  
                    <span style="color: #2196F3; font-weight: 600; font-size: 12px; white-space: nowrap;">${transfer.value}</span>  
                </div>  
            `;
            });
        }
        
        // Ofertas rejeitadas  
        let rejectedHtml = '';
        if (hasRejected) {
            seasonData.rejectedOffers.forEach(offer => {
                const fromLogo = logoMap.get(offer.fromId) || '';
                const toLogo = logoMap.get(offer.toId) || '';
                const playerFlag = flagMap.get(offer.playerCountryId) || '';
                
                rejectedHtml += `  
                <div style="display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid #f0e0e0; font-size: 12px; background: #fff8f8;">  
    ${playerFlag ? `<img src="${playerFlag}" alt="" class="flag-icon-small">` : ''}${offer.player}
</span>
                    ${fromLogo ? `<img src="${fromLogo}" alt="" style="width: 18px; height: 18px; object-fit: contain; opacity: 0.7;">` : '<span style="width:18px;"></span>'}  
                    ${toLogo ? `<img src="${toLogo}" alt="" style="width: 18px; height: 18px; object-fit: contain; opacity: 0.7;">` : '<span style="width:18px;"></span>'}  
                    <span style="color: #e53935; font-size: 10px; white-space: nowrap;" title="Oferta: ${offer.offerValue} | Pedido: ${offer.askingPrice}">  
                        ${offer.offerValue}
                    </span>  
                    <span style="background: #ffebee; color: #c62828; font-size: 9px; padding: 2px 4px; border-radius: 3px; white-space: nowrap;">  
                        ${offer.reason}  
                    </span>  
                </div>  
            `;
            });
        }
        
        container.innerHTML = `  
        <div class="section-card" style="padding: 8px;">  
            <div class="section-header" style="margin-bottom: 8px;">  
                <span style="font-size: 14px; font-weight: 600;">Transferências - T${this.currentSeason}</span>  
                <span style="margin-left: auto; font-size: 11px; color: #666;">  
                    <span style="color: #4CAF50;">${seasonData.transfers?.length || 0} ✓</span>  
                    ${hasRejected ? `<span style="color: #e53935; margin-left: 8px;">${seasonData.rejectedOffers.length} ✗</span>` : ''}  
                </span>  
            </div>  
              
            ${hasTransfers ? `  
                <div style="margin-bottom: 12px;">  
                    <div style="font-size: 12px; font-weight: 600; color: #2e7d32; padding: 4px 8px; background: #e8f5e9; border-radius: 4px; margin-bottom: 4px;">  
 Transferências Concluídas  
                    </div>  
                    <div style="max-height: 250px; overflow-y: auto; border-radius: 4px;">  
                        ${transfersHtml}  
                    </div>  
                </div>  
            ` : ''}  
              
            ${hasRejected ? `  
                <div>  
                    <div style="font-size: 12px; font-weight: 600; color: #c62828; padding: 4px 8px; background: #ffebee; border-radius: 4px; margin-bottom: 4px;">  
 Ofertas Rejeitadas  
                    </div>  
                    <div style="max-height: 200px; overflow-y: auto; border-radius: 4px;">  
                        ${rejectedHtml}  
                    </div>  
                </div>  
            ` : ''}  
        </div>  
    `;
    },


    async displayStandings(containerId) {
        const container = document.getElementById(containerId); 
        if (!container) return;
        
        container.innerHTML = '';
        
        if (this.currentGroups.length > 0) {
            await this.displayGroupStandings(container);
        } else {
            await this.displayLeagueStandings(container);
        }
    },

async displayLeagueStandings(container) {
    await this.displayLeagueStandingsUpToRound(null, container);
},

async displayLeagueStandingsUpToRound(upToRound = null, containerElement = null) {
    const container = containerElement || document.getElementById("seasonStandings");
    if (!container) return;
    
    container.innerHTML = '';
    
    let standingsToShow = this.standings;
    
    if (upToRound !== null && this.schedule && this.schedule.length >= upToRound) {
        standingsToShow = this.calculateStandingsUpToRound(upToRound);
    }
    
    const table = document.createElement("table");
    table.className = "standings-table";
    table.innerHTML = `
        <tr>
            <th>#</th><th>Time</th><th>J</th><th>V</th><th>E</th><th>D</th>
            <th>GP</th><th>GC</th><th>SG</th><th>Pts</th><th>Forma</th>
        </tr>
    `;
    
    const transitions = this.getRelevantTransitions();
    
    const rows = await Promise.all(standingsToShow.map(async (team, index) => {
        const logo = await this.loadLogo(team.id);
        const tr = document.createElement("tr");
        tr.style.cursor = "pointer";
        tr.onclick = () => this.showTeamProfile(team.id);
        
        const position = index + 1;
        
        let positionClass = "";
        transitions.forEach(transition => {
            if (position >= transition.placeStart && position <= transition.placeEnd) {
                if (transition.type === 1) {
                    positionClass = "promoted";
                } else if (transition.type === 2) {
                    positionClass = "relegated";
                } else if (transition.type === 106) {
                    positionClass = "type106";
                }
            }
        });
        
        const forma = this.getTeamForm(team.id, upToRound);
        
        tr.innerHTML = `
<td class="${positionClass}">${position}</td><td>${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${team.name}" class="logo"></div>` : ''}<span style="margin-left:10px">${team.name}</span></td>
            <td>${team.played}</td>
            <td>${team.won}</td>
            <td>${team.drawn}</td>
            <td>${team.lost}</td>
            <td>${team.goalsFor}</td>
            <td>${team.goalsAgainst}</td>
            <td>${team.goalDifference}</td>
            <td><strong>${team.points}</strong></td>
            <td>${forma}</td>
        `;
        return tr;
    }));
    
    rows.forEach(r => table.appendChild(r));
    container.appendChild(table);
},

calculateStandingsUpToRound(round) {
    const tempStandings = {};
    
    this.standings.forEach(team => {
        tempStandings[team.id] = {
            id: team.id,
            name: team.name,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDifference: 0,
            points: 0
        };
    });
    
    for (let i = 0; i < round && i < this.schedule.length; i++) {
        const roundMatches = this.schedule[i];
        roundMatches.forEach(match => {
            if (!match.played) return;
            
            const homeTeam = tempStandings[match.home];
            const awayTeam = tempStandings[match.away];
            
            if (homeTeam && awayTeam) {
                homeTeam.played++;
                awayTeam.played++;
                homeTeam.goalsFor += match.homeScore;
                homeTeam.goalsAgainst += match.awayScore;
                awayTeam.goalsFor += match.awayScore;
                awayTeam.goalsAgainst += match.homeScore;
                
                if (match.homeScore > match.awayScore) {
                    homeTeam.won++;
                    homeTeam.points += 3;
                    awayTeam.lost++;
                } else if (match.homeScore < match.awayScore) {
                    awayTeam.won++;
                    awayTeam.points += 3;
                    homeTeam.lost++;
                } else {
                    homeTeam.drawn++;
                    awayTeam.drawn++;
                    homeTeam.points++;
                    awayTeam.points++;
                }
                
                homeTeam.goalDifference = homeTeam.goalsFor - homeTeam.goalsAgainst;
                awayTeam.goalDifference = awayTeam.goalsFor - awayTeam.goalsAgainst;
            }
        });
    }
    
    return Object.values(tempStandings).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.name.localeCompare(b.name);
    });
},

getTeamForm(teamId, upToRound = null) {
    if (!this.schedule || this.schedule.length === 0) return '';
    
    const maxRound = upToRound || this.schedule.length;
    const results = [];
    
    for (let i = 0; i < maxRound && i < this.schedule.length; i++) {
        const roundMatches = this.schedule[i];
        const match = roundMatches.find(m => m.home === teamId || m.away === teamId);
        
        if (match && match.played) {
            const isHome = match.home === teamId;
            const teamScore = isHome ? match.homeScore : match.awayScore;
            const opponentScore = isHome ? match.awayScore : match.homeScore;
            
            if (teamScore > opponentScore) {
                results.push('V');
            } else if (teamScore < opponentScore) {
                results.push('D');
            } else {
                results.push('E');
            }
        }
    }
    
    const last5 = results.slice(-5);
    
    return last5.map(result => {
        if (result === 'V') {
            return '<span class="form-badge form-win">V</span>';
        } else if (result === 'D') {
            return '<span class="form-badge form-loss">D</span>';
        } else {
            return '<span class="form-badge form-draw">E</span>';
        }
    }).join('');
},

async displayGroupStandings(container) {
    await this.displayGroupStandingsUpToRound(null, container);
},

async displayGroupStandingsUpToRound(upToRound = null, containerElement = null) {
    const container = containerElement || document.getElementById("seasonStandings");
    if (!container || this.currentGroups.length === 0) return;
    
    container.innerHTML = '';
    
    const currentGroup = this.currentGroups[this.currentGroupIndex];
    if (!currentGroup || !currentGroup.standings) return;
    
    let standingsToShow = currentGroup.standings;
    
    if (upToRound !== null && currentGroup.schedule && currentGroup.schedule.length >= upToRound) {
        standingsToShow = this.calculateGroupStandingsUpToRound(currentGroup, upToRound);
    }
    
    const groupHeader = document.createElement("h3");
    groupHeader.textContent = `Grupo ${currentGroup.id}`;
    groupHeader.style.textAlign = "center";
    groupHeader.style.marginBottom = "20px";
    container.appendChild(groupHeader);
    
    const table = document.createElement("table");
    table.className = "standings-table";
    table.innerHTML = `
        <tr>
            <th>#</th><th>Time</th><th>J</th><th>V</th><th>E</th><th>D</th>
            <th>GP</th><th>GC</th><th>SG</th><th>Pts</th><th>Forma</th>
        </tr>
    `;
    
    const numQualified = this.currentStage?.stage?.numberOfClassifieds || 0;
    const transitions = this.getRelevantTransitions();
    
    const rows = await Promise.all(standingsToShow.map(async (team, index) => {
        const logo = await this.loadLogo(team.id);
        const tr = document.createElement("tr");
        tr.style.cursor = "pointer";
        tr.onclick = () => this.showTeamProfile(team.id);
        
        const position = index + 1;
        let positionClass = "";
        
        transitions.forEach(transition => {
            if (position >= transition.placeStart && position <= transition.placeEnd) {
                if (transition.type === 1) {
                    positionClass = "promoted";
                } else if (transition.type === 2) {
                    positionClass = "relegated";
                } else if (transition.type === 106) {
                    positionClass = "type106";
                }
            }
        });
        
        if (!positionClass && position <= numQualified) {
            positionClass = "promoted";
        }
        
        const forma = this.getGroupTeamForm(currentGroup, team.id, upToRound);
        
        tr.innerHTML = `
<td class="${positionClass}">${position}</td><td>${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${team.name}" class="logo"></div>` : ''}<span style="margin-left:10px">${team.name}</span></td>
            <td>${team.played}</td>
            <td>${team.won}</td>
            <td>${team.drawn}</td>
            <td>${team.lost}</td>
            <td>${team.goalsFor}</td>
            <td>${team.goalsAgainst}</td>
            <td>${team.goalDifference}</td>
            <td><strong>${team.points}</strong></td>
            <td>${forma}</td>
        `;
        return tr;
    }));
    
    rows.forEach(r => table.appendChild(r));
    container.appendChild(table);
},

calculateGroupStandingsUpToRound(group, round) {
    const tempStandings = {};
    
    group.standings.forEach(team => {
        tempStandings[team.id] = {
            id: team.id,
            name: team.name,
            played: 0,
            won: 0,
            drawn: 0,
            lost: 0,
            goalsFor: 0,
            goalsAgainst: 0,
            goalDifference: 0,
            points: 0
        };
    });
    
    for (let i = 0; i < round && i < group.schedule.length; i++) {
        const roundMatches = group.schedule[i];
        roundMatches.forEach(match => {
            if (!match.played) return;
            
            const homeTeam = tempStandings[match.home];
            const awayTeam = tempStandings[match.away];
            
            // Cross-group (stageType 3): only one team may be in this group's standings
            if (homeTeam && awayTeam) {
                homeTeam.played++;
                awayTeam.played++;
                homeTeam.goalsFor += match.homeScore;
                homeTeam.goalsAgainst += match.awayScore;
                awayTeam.goalsFor += match.awayScore;
                awayTeam.goalsAgainst += match.homeScore;
                
                if (match.homeScore > match.awayScore) {
                    homeTeam.won++;
                    homeTeam.points += 3;
                    awayTeam.lost++;
                } else if (match.homeScore < match.awayScore) {
                    awayTeam.won++;
                    awayTeam.points += 3;
                    homeTeam.lost++;
                } else {
                    homeTeam.drawn++;
                    awayTeam.drawn++;
                    homeTeam.points++;
                    awayTeam.points++;
                }
                
                homeTeam.goalDifference = homeTeam.goalsFor - homeTeam.goalsAgainst;
                awayTeam.goalDifference = awayTeam.goalsFor - awayTeam.goalsAgainst;
            } else if (homeTeam) {
                homeTeam.played++;
                homeTeam.goalsFor += match.homeScore;
                homeTeam.goalsAgainst += match.awayScore;
                if (match.homeScore > match.awayScore) { homeTeam.won++; homeTeam.points += 3; }
                else if (match.homeScore < match.awayScore) { homeTeam.lost++; }
                else { homeTeam.drawn++; homeTeam.points++; }
                homeTeam.goalDifference = homeTeam.goalsFor - homeTeam.goalsAgainst;
            } else if (awayTeam) {
                awayTeam.played++;
                awayTeam.goalsFor += match.awayScore;
                awayTeam.goalsAgainst += match.homeScore;
                if (match.awayScore > match.homeScore) { awayTeam.won++; awayTeam.points += 3; }
                else if (match.awayScore < match.homeScore) { awayTeam.lost++; }
                else { awayTeam.drawn++; awayTeam.points++; }
                awayTeam.goalDifference = awayTeam.goalsFor - awayTeam.goalsAgainst;
            }
        });
    }
    
    return Object.values(tempStandings).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.name.localeCompare(b.name);
    });
},

getGroupTeamForm(group, teamId, upToRound = null) {
    if (!group.schedule || group.schedule.length === 0) return '';
    
    const maxRound = upToRound || group.schedule.length;
    const results = [];
    
    for (let i = 0; i < maxRound && i < group.schedule.length; i++) {
        const roundMatches = group.schedule[i];
        const match = roundMatches.find(m => m.home === teamId || m.away === teamId);
        
        if (match && match.played) {
            const isHome = match.home === teamId;
            const teamScore = isHome ? match.homeScore : match.awayScore;
            const opponentScore = isHome ? match.awayScore : match.homeScore;
            
            if (teamScore > opponentScore) {
                results.push('V');
            } else if (teamScore < opponentScore) {
                results.push('D');
            } else {
                results.push('E');
            }
        }
    }
    
    const last5 = results.slice(-5);
    
    return last5.map(result => {
        if (result === 'V') {
            return '<span class="form-badge form-win">V</span>';
        } else if (result === 'D') {
            return '<span class="form-badge form-loss">D</span>';
        } else {
            return '<span class="form-badge form-draw">E</span>';
        }
    }).join('');
},

getRelevantTransitions() {
    if (!this.currentStage) return [];
    
    const transitions = this.competitionStageTransitions.filter(t =>
        t.stageIdFrom === this.currentStage.stage.id && (t.type === 0 || t.type === 106)
    );
    
    const relevantTransitions = [];
    
    // Coletar posições específicas para cada tipo
    const promotionPlaces = [];
    const relegationPlaces = [];
    const type106Places = [];
    
    transitions.forEach(transition => {
        if (transition.place > 0) {
            if (transition.type === 106) {
                type106Places.push(transition.place);
            } else if (transition.type === 0) {
                const targetStage = this.competitionStages.find(s => s.id === transition.stageIdTo);
                if (targetStage) {
                    const targetCompetitionIds = targetStage.competitionId.split(',').map(id => id.trim());
                    const currentCompetition = this.currentCompetition.competition;
                    
                    let isPromotion = false;
                    let isRelegation = false;
                    
                    targetCompetitionIds.forEach(targetCompId => {
                        const targetCompetition = this.competitions.find(c => c.id === targetCompId);
                        if (targetCompetition) {
                            if (targetCompetition.importanceOrder < currentCompetition.importanceOrder) {
                                isPromotion = true;
                            } else if (targetCompetition.importanceOrder > currentCompetition.importanceOrder) {
                                isRelegation = true;
                            }
                        }
                    });
                    
                    if (isPromotion) {
                        promotionPlaces.push(transition.place);
                    } else if (isRelegation) {
                        relegationPlaces.push(transition.place);
                    }
                }
            }
        }
    });
    
    // Criar ranges contíguos para cada tipo
    const createContiguousRanges = (places) => {
        if (places.length === 0) return [];
        const sorted = [...places].sort((a, b) => a - b);
        const ranges = [];
        let rangeStart = sorted[0];
        let rangeEnd = sorted[0];
        
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i] === rangeEnd + 1) {
                rangeEnd = sorted[i];
            } else {
                ranges.push({ start: rangeStart, end: rangeEnd });
                rangeStart = sorted[i];
                rangeEnd = sorted[i];
            }
        }
        ranges.push({ start: rangeStart, end: rangeEnd });
        return ranges;
    };
    
    // Criar faixas para promoções (verde)
    const promotionRanges = createContiguousRanges(promotionPlaces);
    promotionRanges.forEach(range => {
        relevantTransitions.push({
            type: 1,
            placeStart: range.start,
            placeEnd: range.end
        });
    });
    
    // Criar faixas para rebaixamentos (vermelho)
    const relegationRanges = createContiguousRanges(relegationPlaces);
    relegationRanges.forEach(range => {
        relevantTransitions.push({
            type: 2,
            placeStart: range.start,
            placeEnd: range.end
        });
    });
    
    // Criar faixas para type 106 (DarkRed)
    const type106Ranges = createContiguousRanges(type106Places);
    type106Ranges.forEach(range => {
        relevantTransitions.push({
            type: 106,
            placeStart: range.start,
            placeEnd: range.end
        });
    });
    
    return relevantTransitions;
},

    async displayRoundMatches(round, containerId) {
        const container = document.getElementById(containerId);
        container.innerHTML = `<h3></h3><div class="matches-list"></div>`;
        const matchesList = container.querySelector(".matches-list");
        
        if (this.currentGroups.length > 0) {
            // Para competições com grupos, mostra todos os jogos de cada grupo nesta rodada
            await this.displayAllGroupsRoundMatches(round, matchesList);
        } else {
            await this.displayLeagueRoundMatches(round, matchesList);
        }
    },

    async displayLeagueRoundMatches(round, matchesList) {
        const roundMatches = this.schedule[round - 1]; 
        if (!roundMatches) {
            matchesList.innerHTML = "<p>Nenhuma partida encontrada para esta rodada</p>";
            return;
        }
        
        for (const match of roundMatches) {
            const home = this.getClub(match.home);
            const away = this.getClub(match.away);
            if (!home || !away) continue;
            
            const [homeLogo, awayLogo] = await Promise.all([
                this.loadLogo(home.id), 
                this.loadLogo(away.id)
            ]);
            
            const matchContainer = document.createElement("div"); 
            matchesList.appendChild(matchContainer);
            
            this.displayMatchResult(
                home, away, 
                match.played ? match.homeScore : "vs", 
                match.played ? match.awayScore : "", 
                homeLogo, awayLogo, 
                matchContainer
            );
        }
    },

    async displayAllGroupsRoundMatches(round, matchesList) {
        // Exibe jogos de TODOS os grupos separados por seção (sem duplicatas para cross-group)
        if (this.currentGroups.length === 0) return;
        
        const isCrossGroup = this.currentGroups[0]?.isCrossGroup;
        const displayedMatchKeys = new Set();
        
        for (const group of this.currentGroups) {
            const groupMatches = group.schedule ? group.schedule[round - 1] : null;
            
            if (!groupMatches || groupMatches.length === 0) continue;
            
            // Para cross-group, filtrar duplicatas (mesmo jogo pode estar em 2 grupos)
            const matchesToShow = isCrossGroup 
                ? groupMatches.filter(m => {
                    const key = [m.home, m.away].sort().join('-');
                    if (displayedMatchKeys.has(key)) return false;
                    displayedMatchKeys.add(key);
                    return true;
                })
                : groupMatches;
            
            if (matchesToShow.length === 0) continue;
            
            // Cabeçalho do grupo
            const groupHeader = document.createElement("div");
            groupHeader.className = "group-matches-header";
            groupHeader.innerHTML = `<h4 style="margin: 20px 0 10px 0; padding: 10px; border-radius: 5px; text-align: center; font-weight: bold;">Grupo ${group.id}</h4>`;
            matchesList.appendChild(groupHeader);
            
            const groupMatchesContainer = document.createElement("div");
            groupMatchesContainer.className = "group-matches-container";
            groupMatchesContainer.style.marginBottom = "15px";
            groupMatchesContainer.style.padding = "10px";
            groupMatchesContainer.style.backgroundColor = "transparent";
            groupMatchesContainer.style.borderRadius = "5px";
            
            for (const match of matchesToShow) {
                const home = this.getClub(match.home);
                const away = this.getClub(match.away);
                if (!home || !away) continue;
                
                const [homeLogo, awayLogo] = await Promise.all([
                    this.loadLogo(home.id), 
                    this.loadLogo(away.id)
                ]);
                
                const matchContainer = document.createElement("div"); 
                groupMatchesContainer.appendChild(matchContainer);
                
                this.displayMatchResult(
                    home, away, 
                    match.played ? match.homeScore : "vs", 
                    match.played ? match.awayScore : "", 
                    homeLogo, awayLogo, 
                    matchContainer
                );
            }
            
            matchesList.appendChild(groupMatchesContainer);
        }
    },

    async displayGroupRoundMatches(round, matchesList) {
        // Mantida para compatibilidade - exibe apenas o grupo selecionado
        if (this.currentGroups.length === 0) return;
        
        const currentGroup = this.currentGroups[this.currentGroupIndex];
        const groupMatches = currentGroup.schedule ? currentGroup.schedule[round - 1] : null;
        
        if (!groupMatches) {
            matchesList.innerHTML = "<p>Nenhuma partida encontrada para esta rodada</p>";
            return;
        }
        
        for (const match of groupMatches) {
            const home = this.getClub(match.home);
            const away = this.getClub(match.away);
            if (!home || !away) continue;
            
            const [homeLogo, awayLogo] = await Promise.all([
                this.loadLogo(home.id), 
                this.loadLogo(away.id)
            ]);
            
            const matchContainer = document.createElement("div"); 
            matchesList.appendChild(matchContainer);
            
            this.displayMatchResult(
                home, away, 
                match.played ? match.homeScore : "vs", 
                match.played ? match.awayScore : "", 
                homeLogo, awayLogo, 
                matchContainer
            );
        }
    },

    async displayPlayoffBracket() {
        const container = document.getElementById("playoffBracket");
        container.innerHTML = "<h3>Chaveamento do Playoff</h3>";
        
        if (!this.playoffBracket || this.playoffBracket.length === 0) {
            container.innerHTML += "<p>Nenhum dado de playoff disponível</p>";
            return;
        }
        
        for (const round of this.playoffBracket) {
            const roundName = this.getRoundName(round.number, this.playoffBracket.length);
            
            const hasTwoLegs = round.matches.length > 0 && round.matches[0].numLegs > 1;
            
            if (hasTwoLegs) {
                const idaRound = document.createElement("div");
                idaRound.className = "playoff-round";
                idaRound.innerHTML = `<h4>${roundName} - Ida</h4>`;
                
                const voltaRound = document.createElement("div");
                voltaRound.className = "playoff-round";
                voltaRound.innerHTML = `<h4>${roundName} - Volta</h4>`;
                
                for (const match of round.matches) {
                    
                    
                    const team1 = this.getClub(match.team1.id);
                    const team2 = this.getClub(match.team2.id);
                    if (!team1 || !team2) continue;
                    
                    const penaltyText = match.isPenalty ? " (P)" : "";
                    const team1Name = match.winner && match.winner.id === match.team1.id ? 
                        team1.name + penaltyText : team1.name;
                    const team2Name = match.winner && match.winner.id === match.team2.id ? 
                        team2.name + penaltyText : team2.name;
                    
                    const [team1Logo, team2Logo] = await Promise.all([
                        this.loadLogo(match.team1.id),
                        this.loadLogo(match.team2.id)
                    ]);
                    
                    const idaMatch = document.createElement("div");
                    idaMatch.className = "playoff-match";
                    this.displayMatchResult(
                        { ...team1, name: team1Name },
                        { ...team2, name: team2Name },
                        match.homeScore,
                        match.awayScore,
                        team1Logo,
                        team2Logo,
                        idaMatch
                    );
                    idaRound.appendChild(idaMatch);
                    
                    const voltaMatch = document.createElement("div");
                    voltaMatch.className = "playoff-match";
                    this.displayMatchResult(
                        { ...team2, name: team2Name },
                        { ...team1, name: team1Name },
                        match.homeScore2,
                        match.awayScore2,
                        team2Logo,
                        team1Logo,
                        voltaMatch
                    );
                    voltaRound.appendChild(voltaMatch);
                }
                
                container.appendChild(idaRound);
                container.appendChild(voltaRound);
                
            } else {
                const roundDiv = document.createElement("div");
                roundDiv.className = "playoff-round";
                roundDiv.innerHTML = `<h4>${roundName}</h4>`;
                
                for (const match of round.matches) {
                    const matchDiv = document.createElement("div");
                    matchDiv.className = "playoff-match";
                    
                    const team1 = this.getClub(match.team1.id);
                        const team2 = this.getClub(match.team2.id);
                        if (!team1 || !team2) continue;
                        
                        const penaltyText = match.isPenalty ? " (P)" : "";
                        const team1Name = match.winner && match.winner.id === match.team1.id ? 
                            team1.name + penaltyText : team1.name;
                        const team2Name = match.winner && match.winner.id === match.team2.id ? 
                            team2.name + penaltyText : team2.name;
                        
                        const [team1Logo, team2Logo] = await Promise.all([
                            this.loadLogo(match.team1.id),
                            this.loadLogo(match.team2.id)
                        ]);
                        
                        this.displayMatchResult(
                            { ...team1, name: team1Name },
                            { ...team2, name: team2Name },
                            match.homeScore,
                            match.awayScore,
                            team1Logo,
                            team2Logo,
                            matchDiv
                        );
                    roundDiv.appendChild(matchDiv);
                }
                container.appendChild(roundDiv);
            }
        }
    },

    getRoundName(roundNumber, totalRounds) {
        const roundNames = ["Final", "Semi-final", "Quartas-de-final", "Oitavas-de-final", "16 avos-de-final"];
        const index = totalRounds - roundNumber;
        return roundNames[index] || `Rodada ${roundNumber}`;
    },

    showTeamProfile(teamId) {
        const team = this.getClub(teamId);
        if (!team) return;
        
        Promise.all([this.loadLogo(teamId), this.loadFlag(team.countryId)]).then(([logo, flag]) => {
            const country = this.countries.find(c => String(c.id) === String(team.countryId))?.name || '-';
            
            const competitionsText = team.competitions.map(compId => {
                const comp = this.competitions.find(c => c.id === compId);
                return comp ? comp.name : 'Competição desconhecida';
            }).join(', ') || '-';
            
            let teamRelation = 'Time Principal';
            
            if (team.bTeamOf) {
                const mainTeam = this.clubs.find(c => c.id === team.bTeamOf);
                teamRelation = mainTeam ? `Time B de ${mainTeam.name}` : 'Time B';
            }
            
            const currentSeasonData = this.getSeasonData();
            let seasonStats = null;
            if (currentSeasonData) {
                for (const competitionData of currentSeasonData.competitions) {
                    for (const stageData of competitionData.stages) {
                        seasonStats = stageData.clubsStats.find(s => s.id === teamId);
                        if (seasonStats) break;
                    }
                    if (seasonStats) break;
                }
            }
            
            // Calcular médias de ataque/defesa baseadas na formação
            const formationStats = this.calculateFormationAverages(teamId);
            
const profileHTML = `
    <div class="profile-buttons" style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px;">
        <button id="viewTitlesBtn" class="btn btn-primary">Ver Títulos</button>
        <button id="viewTrajectoryBtn" class="btn btn-primary">Trajetória</button>
        <button id="viewSquadBtn" class="btn btn-success">Elenco</button>
    </div>

    <div style="text-align: center;">
        ${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${team.name}" class="logo"></div>` : ''} 
        ${team.name}
    </div>

    <p><strong>País:</strong> 
        ${flag ? `<img src="${flag}" alt="" class="flag-icon">` : ''}${country}
    </p>

    <p><strong>Competições:</strong> ${competitionsText}</p>
    <p><strong>Rating:</strong> ${team.originalRating.toFixed(1)}</p>
    <p><strong>Balanço:</strong> ${this.formatValue(team.transferBalance || 0)}</p>

    <hr style="margin: 10px 0; border-color: #ddd;">

    <p><strong>Base Juvenil:</strong> ${team.youth || 10}/20</p>
    <p><strong>Formação:</strong> ${formationStats.formation}</p>
    <p><strong>ATA:</strong> ${Math.round(formationStats.attack)}  <strong>MEI:</strong> ${Math.round(formationStats.midfield)}  <strong>DEF:</strong> ${Math.round(formationStats.defense)}</p>
`;
            
            document.getElementById('profileContent').innerHTML = profileHTML;
            document.getElementById('teamProfile').style.display = 'block';
            
            document.getElementById('viewTitlesBtn').addEventListener('click', () => this.showTeamTitles(teamId));
            document.getElementById('viewTrajectoryBtn').addEventListener('click', () => this.showTeamTrajectory(teamId));
            document.getElementById('viewSquadBtn').addEventListener('click', () => this.showTeamSquad(teamId));
        });
    },
    
    // Nova função: Mostrar elenco do time
async showTeamSquad(teamId) {
    const team = this.getClub(teamId);
    if (!team) return;
    
    const teamPlayers = this.players
        .filter(p => p.clubId === teamId && !p.retired)
        .sort((a, b) => a.role - b.role || b.rating - a.rating);
    
    // Pré-carregar todas as bandeiras dos jogadores
    const countryIds = [...new Set(teamPlayers.map(p => p.countryId).filter(Boolean))];
    const flagMap = new Map();
    await Promise.all(countryIds.map(async cId => {
        flagMap.set(cId, await this.loadFlag(cId));
    }));
    
    let squadHTML = '';
    
    if (teamPlayers.length > 0) {
        const currentYear = new Date().getFullYear() + this.seasonHistory.length;
        
        squadHTML = `
        <div style="max-height: 400px; overflow-y: auto;">
            <table class="standings-table" style="width: 100%; margin-top: 10px;">
                <thead>
                    <tr>
                        <th>Pos</th>
                        <th style="min-width: 150px;">Nome</th>
                        <th>Idade</th>
                        <th>OVR</th>
                        <th>POT</th>
                        <th>Valor</th>
                    </tr>
                </thead>
                <tbody>
        `;
        
        teamPlayers.forEach(player => {
            const age = currentYear - player.dob;
            const roleInfo = this.roleMap[player.role] || { name: '?' };
            const value = this.calcPlayerValue(player);
            const flag = flagMap.get(player.countryId) || '';
            
            squadHTML += `
            <tr style="cursor: pointer;" onclick="App.showPlayerProfile('${player.id}')">
                <td>${roleInfo.name}</td>
                <td style="white-space: nowrap; text-align: left;">
                    ${flag ? `<img src="${flag}" alt="" class="flag-icon" style="margin-right: 5px; vertical-align: middle">` : ''}
                    ${player.name}
                </td>
                <td>${age}</td>
                <td>${player.rating.toFixed(0)}</td>
                <td>${player.ratingPotential.toFixed(0)}</td>
                <td>${this.formatValue(value)}</td>
            </tr>
            `;
        });
        
        squadHTML += `
                </tbody>
            </table>
        </div>
        `;
    } else {
        squadHTML = `<div style="text-align: center; padding: 20px; color: #666;">Nenhum jogador no elenco</div>`;
    }
    
    const logo = await this.loadLogo(teamId);
    document.getElementById('profileContent').innerHTML = `
    <div class="profile-buttons" style="display: flex; gap: 10px; margin-bottom: 20px;">
        <button id="backToProfileBtn" class="btn btn-secondary">Voltar ao Perfil</button>
    </div>
    <div style="text-align: center;">
        ${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${team.name}" class="logo"></div>` : ''} 
        ${team.name}
    </div>
    <h4 style="text-align: center;">Elenco (${this.players.filter(p => p.clubId === teamId && !p.retired).length} jogadores)</h4>
    ${squadHTML}
    `;
    document.getElementById('backToProfileBtn').addEventListener('click', () => this.showTeamProfile(teamId));
},
    
    // Nova função: Mostrar perfil do jogador
    showPlayerProfile(playerId) {
        const player = this.players.find(p => p.id === playerId);
        if (!player) return;
        
        const club = this.getClub(player.clubId);
        const country = this.countries.find(c => String(c.id) === String(player.countryId))?.name || '-';
        const roleInfo = this.roleMap[player.role] || { name: '?' };
        const currentYear = new Date().getFullYear() + this.seasonHistory.length;
        const age = currentYear - player.dob;
        const value = this.calcPlayerValue(player);
        
        // Buscar estatísticas do jogador
        const playerStatsData = this.playerStats.filter(s => s.playerId === playerId);
        
        let statsHTML = '';
        if (playerStatsData.length > 0) {
            statsHTML = `
            <h4 style="text-align: center; margin-top: 20px;">Estatísticas</h4>
            <div style="max-height: 200px; overflow-y: auto;">
                <table class="standings-table" style="width: 100%;">
                    <thead>
                        <tr>
                            <th>Ano</th>
                            <th>Clube</th>
                            <th>Jogos</th>
                            <th>Gols</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            playerStatsData.forEach(stat => {
                const statClub = this.getClub(stat.clubId);
                statsHTML += `
                <tr>
                    <td>${stat.year}</td>
                    <td>${statClub ? statClub.name : '-'}</td>
                    <td>${stat.games}</td>
                    <td>${stat.goals}</td>
                </tr>
                `;
            });
            
            statsHTML += `
                    </tbody>
                </table>
            </div>
            `;
        }
        
        const totalGoals = playerStatsData.reduce((sum, s) => sum + s.goals, 0);
        const totalGames = playerStatsData.reduce((sum, s) => sum + s.games, 0);
        
        Promise.all([this.loadLogo(player.clubId), this.loadFlag(player.countryId)]).then(([logo, flag]) => {
            document.getElementById('profileContent').innerHTML = `
            <div class="profile-buttons" style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button id="backToSquadBtn" class="btn btn-secondary">Voltar ao Elenco</button>
            </div>
<div style="text-align: center;">
    ${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${club?.name}" class="logo"></div>` : ''} 
    <h3>
        ${flag ? `<img src="${flag}" alt="" class="flag-icon">` : ''}${player.name}
    </h3>
</div>
            <p><strong>Posição:</strong> ${roleInfo.name}</p>
<p><strong>Nacionalidade:</strong> 
    ${flag ? `<img src="${flag}" alt="" class="flag-icon">` : ''}${country}
</p>
<p><strong>Idade:</strong> ${age} anos (${player.dob})</p>
<p><strong>Overall:</strong> ${player.rating.toFixed(0)}</p>
<p><strong>Potencial:</strong> ${player.ratingPotential.toFixed(0)}</p>
<p><strong>Valor:</strong> ${this.formatValue(value)}</p>
<p><strong>Gols na Carreira:</strong> ${totalGoals}</p>
<p><strong>Jogos na Carreira:</strong> ${totalGames}</p>
${statsHTML}`;
            document.getElementById('backToSquadBtn').addEventListener('click', () => this.showTeamSquad(player.clubId));
        });
    },
    
    showTeamTitles(teamId) {
        const team = this.getClub(teamId);
        if (!team) return;
        
        const titles = this.teamTitles.get(teamId);
        let titlesHTML = '';
        
        if (titles && titles.championships && titles.championships.size > 0) {
            titlesHTML = `<div class="titles-list">`;
            titles.championships.forEach((count, compId) => {
                const comp = this.competitions.find(c => c.id === compId);
                if (comp) {
                    titlesHTML += `
                    <div class="title-item" style="display: flex; align-items: center; justify-content: space-between; margin: 10px 0; padding: 10px; background: #f9f9f9; border-radius: 5px;">
                        <span class="title-name">${comp.name}</span>
                        <span class="title-count">${count} título${count > 1 ? 's' : ''}</span>
                    </div>`;
                }
            });
            titlesHTML += `</div>`;
        } else {
            titlesHTML = `<div style="text-align: center; padding: 20px; color: #666;">Nenhum título conquistado</div>`;
        }
        
        this.loadLogo(teamId).then(logo => {
            document.getElementById('profileContent').innerHTML = `
            <div class="profile-buttons" style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button id="backToProfileBtn" class="btn btn-secondary">Voltar ao Perfil</button>
            </div>
            <div style="text-align: center;">
    ${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${team.name}" class="logo"></div>` : ''} 
    ${team.name}
</div>
            <h4 style="text-align: center;">Títulos Conquistados</h4>
            ${titlesHTML}
        `;
            document.getElementById('backToProfileBtn').addEventListener('click', () => this.showTeamProfile(teamId));
        });
    },
    
    showTeamTrajectory(teamId) {
        const team = this.getClub(teamId);
        if (!team) return;
        
        let trajectoryData = [];
        
        this.seasonHistory.forEach((season, seasonIndex) => {
            const year = seasonIndex + 1;
            
            season.competitions.forEach(competitionData => {
                const competition = competitionData.competition;
                
                competitionData.stages.forEach(stageData => {
                    if (stageData.standings) {
                        const teamStanding = stageData.standings.find(s => s.id === teamId);
                        if (teamStanding) {
                            const position = stageData.standings.indexOf(teamStanding) + 1;
                            trajectoryData.push({
                                year: year,
                                competition: competition.name,
                                stage: stageData.stage.name,
                                games: teamStanding.played,
                                wins: teamStanding.won,
                                draws: teamStanding.drawn,
                                losses: teamStanding.lost,
                                position: `${position}º`,
                                points: teamStanding.points
                            });
                        }
                    }
                });
            });
        });
        
        let tableHTML = '';
        if (trajectoryData.length > 0) {
            tableHTML = `
            <div style="max-height: 400px; overflow-y: auto;">
                <table class="standings-table" style="width: 100%; margin-top: 20px;">
                    <thead>
                        <tr>
                            <th>Ano</th>
                            <th>Competição</th>
                            <th>Fase</th>
                            <th>J</th>
                            <th>V</th>
                            <th>E</th>
                            <th>D</th>
                            <th>Pts</th>
                            <th>Pos</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            trajectoryData.forEach(data => {
                tableHTML += `
                <tr>
                    <td>${data.year}</td>
                    <td>${data.competition}</td>
                    <td>${data.stage}</td>
                    <td>${data.games}</td>
                    <td>${data.wins}</td>
                    <td>${data.draws}</td>
                    <td>${data.losses}</td>
                    <td>${data.points}</td>
                    <td>${data.position}</td>
                </tr>
                `;
            });
            
            tableHTML += `
                    </tbody>
                </table>
            </div>
            `;
        } else {
            tableHTML = `<div style="text-align: center; padding: 20px; color: #666;">Nenhuma estatística disponível</div>`;
        }
        
        this.loadLogo(teamId).then(logo => {
            document.getElementById('profileContent').innerHTML = `
            <div class="profile-buttons" style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button id="backToProfileBtn" class="btn btn-secondary">Voltar ao Perfil</button>
            </div>
            <div style="text-align: center;">
                ${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${team.name}" class="logo"></div>` : ''} 
                ${team.name}
            </div>
            <h4 style="text-align: center;">Trajetória do Time</h4>
            ${tableHTML}
            `;
            document.getElementById('backToProfileBtn').addEventListener('click', () => this.showTeamProfile(teamId));
        });
    },

    // =============================================
    // === SISTEMA DE SAVE/LOAD BINÁRIO (.bin) ===
    // =============================================

    SAVE_MAGIC: [0x46, 0x42, 0x53, 0x56], // "FBSV"
    SAVE_VERSION: 2,

    // Extrai estado serializável — salva TUDO (exceto dados fixos: playerFicticiousNames, countries, continents, playerYouthReveal, competitionStageAwards)
    getSerializableState() {
        // Clubs: apenas dados mutáveis (nome, país, estádio, etc. vêm do DB e não mudam)
        const clubs = this.clubs.map(c => ({
            id: c.id,
            rating: c.rating,
            transferBalance: c.transferBalance,
            youth: c.youth,
            competitions: c.competitions ? [...c.competitions] : [],
            stages: c.stages ? [...c.stages] : [],
            originalCompetitions: c.originalCompetitions ? [...c.originalCompetitions] : [],
            originalStages: c.originalStages ? [...c.originalStages] : []
        }));

        // Players: dados mutáveis + identificação mínima para jogadores gerados
        const players = this.players.map(p => {
            const obj = {
                id: p.id,
                rating: p.rating != null ? p.rating : 0,
                ratingPotential: p.ratingPotential != null ? p.ratingPotential : 0,
                clubId: p.clubId || null,
                role: p.role || 0,
                dob: p.dob || 2000,
                retired: !!p.retired
            };
            // Salvar nome/país/originalClubId apenas para jogadores gerados (youth)
            // que não existem no DB original
            if (p._generated) {
                obj.name = p.name;
                obj.countryId = p.countryId;
                obj.originalClubId = p.originalClubId;
                obj._generated = true;
            }
            return obj;
        });

        // teamTitles: Map → object
        const titles = {};
        if (this.teamTitles && this.teamTitles.forEach) {
            this.teamTitles.forEach((val, key) => {
                if (!key) return;
                const champs = {};
                if (val && val.championships && val.championships.forEach) {
                    val.championships.forEach((count, compId) => {
                        if (compId != null) champs[compId] = count || 0;
                    });
                }
                titles[key] = champs;
            });
        }

        // clubFormations: Map → object
        const formations = {};
        if (this.clubFormations && this.clubFormations.forEach) {
            this.clubFormations.forEach((val, key) => {
                if (key != null) formations[key] = val;
            });
        }

        // nextSeasonInjections: Map → object (salva IDs dos clubs)
        const injections = {};
        if (this.nextSeasonInjections && this.nextSeasonInjections.forEach) {
            this.nextSeasonInjections.forEach((clubList, stageId) => {
                if (stageId != null && Array.isArray(clubList)) {
                    injections[stageId] = clubList.filter(c => c && c.id).map(c => c.id);
                }
            });
        }

        // seasonHistory: salva como está, sem compactar
        const history = JSON.parse(JSON.stringify(this.seasonHistory || []));

        // playerStats: salva como está
        const stats = JSON.parse(JSON.stringify(this.playerStats || []));

        // Estado da temporada em progresso
        let weeklyState = null;
        if (this.seasonInProgress && this.seasonState) {
            weeklyState = JSON.parse(JSON.stringify(this.seasonState));
        }

        return {
            clubs, players, titles, formations, injections, history, stats,
            currentSeason: this.currentSeason || 0,
            seasonInProgress: !!this.seasonInProgress,
            weeklyState,
            rejectedOffers: JSON.parse(JSON.stringify(this.rejectedOffers || [])),
            standings: JSON.parse(JSON.stringify(this.standings || [])),
            schedule: JSON.parse(JSON.stringify(this.schedule || [])),
            playoffBracket: JSON.parse(JSON.stringify(this.playoffBracket || [])),
            currentGroups: JSON.parse(JSON.stringify(this.currentGroups || [])),
            currentGroupIndex: this.currentGroupIndex || 0,
            currentDivisions: JSON.parse(JSON.stringify(this.currentDivisions || [])),
            currentDivisionIndex: this.currentDivisionIndex || 0,
            currentCompetition: this.currentCompetition ? JSON.parse(JSON.stringify(this.currentCompetition)) : null,
            currentStage: this.currentStage ? JSON.parse(JSON.stringify(this.currentStage)) : null,
            currentSeasonPreview: this.currentSeasonPreview ? JSON.parse(JSON.stringify(this.currentSeasonPreview)) : null,
            saveVersion: 2
        };
    },

    // Restaurar estado a partir de dados desserializados
    restoreState(state) {
        // Restaurar clubs — apenas dados mutáveis, nunca sobrescrever dados fixos do DB
        if (state.clubs) {
            const clubMap = new Map(this.clubs.map(c => [c.id, c]));
            state.clubs.forEach(saved => {
                if (!saved || !saved.id) return;
                const club = clubMap.get(saved.id);
                if (!club) return; // Club não existe no DB, ignorar
                // Apenas atualizar campos que mudam durante simulação
                if (saved.rating != null) club.rating = saved.rating;
                if (saved.transferBalance != null) club.transferBalance = saved.transferBalance;
                if (saved.youth != null) club.youth = saved.youth;
                if (Array.isArray(saved.competitions) && saved.competitions.length > 0) club.competitions = saved.competitions;
                if (Array.isArray(saved.stages) && saved.stages.length > 0) club.stages = saved.stages;
                if (Array.isArray(saved.originalCompetitions) && saved.originalCompetitions.length > 0) {
                    club.originalCompetitions = saved.originalCompetitions;
                } else if (Array.isArray(saved.competitions) && saved.competitions.length > 0) {
                    club.originalCompetitions = saved.competitions;
                }
                if (Array.isArray(saved.originalStages) && saved.originalStages.length > 0) {
                    club.originalStages = saved.originalStages;
                } else if (Array.isArray(saved.stages) && saved.stages.length > 0) {
                    club.originalStages = saved.stages;
                }
            });
        }

        // Restaurar players — apenas dados mutáveis, preservar nome/país do DB
        if (state.players) {
            this.players.forEach(p => p.retired = true);
            const playerMap = new Map(this.players.map(p => [p.id, p]));
            
            state.players.forEach(saved => {
                if (!saved || !saved.id) return;
                let player = playerMap.get(saved.id);
                if (player) {
                    // Apenas atualizar campos mutáveis, nunca sobrescrever nome/país/originalClubId do DB
                    if (saved.rating != null) player.rating = saved.rating;
                    if (saved.ratingPotential != null) player.ratingPotential = saved.ratingPotential;
                    player.clubId = saved.clubId || null;
                    if (saved.role != null) player.role = saved.role;
                    if (saved.dob != null) player.dob = saved.dob;
                    player.retired = !!saved.retired;
                } else if (saved._generated || (typeof saved.id === 'string' && (saved.id.startsWith('youth_') || saved.id.startsWith('gen_')))) {
                    // Jogador gerado (youth/fictício) que não existe no DB — criar completo
                    const newPlayer = {
                        id: saved.id,
                        name: saved.name || 'Jogador ' + saved.id,
                        rating: saved.rating || 0,
                        ratingPotential: saved.ratingPotential || 0,
                        clubId: saved.clubId || null,
                        countryId: saved.countryId || null,
                        role: saved.role || 0,
                        dob: saved.dob || 2000,
                        retired: !!saved.retired,
                        originalClubId: saved.originalClubId || null,
                        _generated: true
                    };
                    this.players.push(newPlayer);
                }
                // Se o jogador não existe no DB e não é gerado, ignorar (evita dados corrompidos)
            });
        }

        // Restaurar teamTitles
        if (state.titles) {
            this.teamTitles = new Map();
            Object.entries(state.titles).forEach(([clubId, champs]) => {
                const championships = new Map();
                Object.entries(champs).forEach(([compId, count]) => {
                    championships.set(compId, count);
                });
                this.teamTitles.set(clubId, { championships });
            });
        }

        // Restaurar clubFormations
        if (state.formations) {
            this.clubFormations = new Map();
            Object.entries(state.formations).forEach(([key, val]) => {
                this.clubFormations.set(key, val);
            });
        }

        // Restaurar nextSeasonInjections
        if (state.injections) {
            this.nextSeasonInjections = new Map();
            Object.entries(state.injections).forEach(([stageId, clubIds]) => {
                const clubs = clubIds.map(id => this.clubs.find(c => c.id === id)).filter(Boolean);
                if (clubs.length > 0) this.nextSeasonInjections.set(stageId, clubs);
            });
        }

        // Restaurar playerStats como está
        if (state.stats) {
            this.playerStats = state.stats;
        }

        // Restaurar seasonHistory como está
        if (state.history) {
            this.seasonHistory = state.history;
        }

        this.currentSeason = state.currentSeason || this.seasonHistory.length;

        // Restaurar rejectedOffers
        this.rejectedOffers = state.rejectedOffers || [];

        // Restaurar estado de simulação
        if (state.seasonInProgress && state.weeklyState) {
            this.seasonState = state.weeklyState;
            this.seasonInProgress = true;
        } else {
            this.seasonState = null;
            this.seasonInProgress = false;
        }
        this.currentSeasonPreview = state.currentSeasonPreview || null;
        this.standings = state.standings || [];
        this.schedule = state.schedule || [];
        this.playoffBracket = state.playoffBracket || [];
        this.currentGroups = state.currentGroups || [];
        this.currentGroupIndex = state.currentGroupIndex || 0;
        this.currentDivisions = state.currentDivisions || [];
        this.currentDivisionIndex = state.currentDivisionIndex || 0;
        this.currentCompetition = state.currentCompetition || null;
        this.currentStage = state.currentStage || null;

        // Rebuildar caches
        this.buildClubsMap();
        this.playersMap = new Map(this.players.map(p => [p.id, p]));
        this.invalidatePlayerCache();
    },

    // Serializar estado para ArrayBuffer comprimido (.bin)
    async exportSave() {
        const state = this.getSerializableState();
        const json = JSON.stringify(state);
        const textEncoder = new TextEncoder();
        const data = textEncoder.encode(json);

        // Header: FBSV (4) + version (2) + seasonCount (4) + uncompressedSize (4) = 14 bytes
        const header = new ArrayBuffer(14);
        const headerView = new DataView(header);
        this.SAVE_MAGIC.forEach((b, i) => headerView.setUint8(i, b));
        headerView.setUint16(4, this.SAVE_VERSION, true);
        headerView.setUint32(6, this.seasonHistory.length, true);
        headerView.setUint32(10, data.byteLength, true);

        // Comprimir com gzip
        const compressed = await this._compress(data);

        // Juntar header + compressed
        const result = new Uint8Array(header.byteLength + compressed.byteLength);
        result.set(new Uint8Array(header), 0);
        result.set(compressed, header.byteLength);

        return result.buffer;
    },

    // Desserializar ArrayBuffer (.bin) para estado
    async importSave(buffer) {
        const view = new DataView(buffer);

        // Validar magic
        for (let i = 0; i < 4; i++) {
            if (view.getUint8(i) !== this.SAVE_MAGIC[i]) {
                throw new Error('Arquivo .bin inválido: magic bytes incorretos');
            }
        }

        const version = view.getUint16(4, true);
        if (version > this.SAVE_VERSION) {
            throw new Error(`Versão do save (${version}) não suportada. Atualize o simulador.`);
        }

        const seasonCount = view.getUint32(6, true);
        // const uncompressedSize = view.getUint32(10, true); // Para validação futura

        // Dados comprimidos começam no byte 14
        const compressed = new Uint8Array(buffer, 14);
        const decompressed = await this._decompress(compressed);

        const textDecoder = new TextDecoder();
        const json = textDecoder.decode(decompressed);
        const state = JSON.parse(json);

        return { state, seasonCount, version };
    },

    async _compress(data) {
        if (typeof CompressionStream !== 'undefined') {
            const cs = new CompressionStream('gzip');
            const writer = cs.writable.getWriter();
            writer.write(data);
            writer.close();
            const reader = cs.readable.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.byteLength;
            }
            return result;
        } else {
            // Fallback: sem compressão (browsers muito antigos)
            return data;
        }
    },

    async _decompress(data) {
        if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            writer.write(data);
            writer.close();
            const reader = ds.readable.getReader();
            const chunks = [];
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
            }
            const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
            const result = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.byteLength;
            }
            return result;
        } else {
            return data;
        }
    },

    // Download do save como .bin
async downloadSave() {
    try {
        const saveData = {
            clubs: this.clubs,
            players: this.players,
            seasonHistory: this.seasonHistory,
            currentSeason: this.currentSeason,
            teamTitles: Array.from(this.teamTitles.entries()),
            playerStats: this.playerStats,
            // rejectedOffers removido para poupar espaço
        };

        const jsonString = JSON.stringify(saveData);
        const encoder = new TextEncoder();
        const data = encoder.encode(jsonString);

        // Compressão GZIP real
        const cs = new CompressionStream('gzip');
        const writer = cs.writable.getWriter();
        writer.write(data);
        writer.close();

        const compressedBuffer = await new Response(cs.readable).arrayBuffer();
        const blob = new Blob([compressedBuffer], { type: 'application/octet-stream' });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `save_temporada_${this.currentSeason}.bin`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error("Erro ao salvar:", e);
        alert("Erro ao gerar ficheiro binário.");
    }
},


    // Upload e restauração de save .bin
async uploadSave(file) {
    try {
        const button = document.getElementById('loadProgressBtn');
        button.disabled = true;

        const arrayBuffer = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);
        
        let jsonString;

        // VERIFICAÇÃO DE COMPATIBILIDADE:
        // GZIP sempre começa com os bytes 0x1f 0x8b
        if (uint8[0] === 0x1f && uint8[1] === 0x8b) {
            // Ficheiro Novo (Binário Comprimido)
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            writer.write(arrayBuffer);
            writer.close();
            const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
            jsonString = new TextDecoder().decode(decompressedBuffer);
        } else {
            // Ficheiro Antigo (Texto JSON)
            jsonString = new TextDecoder().decode(arrayBuffer);
        }
        
        const data = JSON.parse(jsonString);

        // Restaura os dados no objeto App
        this.clubs = data.clubs;
        this.players = data.players;
        this.seasonHistory = data.seasonHistory || [];
        this.currentSeason = data.currentSeason;
        this.teamTitles = new Map(data.teamTitles || []);
        this.playerStats = data.playerStats || [];
        this.rejectedOffers = []; // Limpa lixo acumulado

        // --- ATUALIZAÇÃO DA UI SEM RELOAD ---
        this.buildClubsMap(); // Recria os índices internos O(1)
        this.updateSeasonSelects(); // Atualiza a lista de temporadas no menu
        
        // Se houver histórico, mostra a última temporada carregada
        if (this.seasonHistory.length > 0) {
            const lastSeason = this.seasonHistory.length;
            document.getElementById("viewSeason").value = lastSeason;
            this.viewSeason(lastSeason); 
        }

        // Feedback visual
        const progress = document.getElementById("seasonProgress");
        if (progress) {
            progress.innerHTML = `<span style="color:#4ade80;">✅ Save carregado com sucesso!</span>`;
            progress.style.display = 'block';
        }

        alert("Progresso carregado com sucesso!");

    } catch (e) {
        console.error('Erro no Load:', e);
        alert('Este ficheiro não é um save válido ou está incompatível.');
    } finally {
        document.getElementById('loadProgressBtn').disabled = false;
    }
},

    setupSaveLoadListeners() {
        const saveBtn = document.getElementById('saveProgressBtn');
        const loadBtn = document.getElementById('loadProgressBtn');
        const fileInput = document.getElementById('loadFileInput');

        if (saveBtn) saveBtn.addEventListener('click', () => this.downloadSave());
        if (loadBtn) loadBtn.addEventListener('click', () => fileInput.click());
        if (fileInput) fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.uploadSave(file);
                fileInput.value = ''; // Reset para permitir carregar o mesmo arquivo de novo
            }
        });
    }
};

document.addEventListener("DOMContentLoaded", () => App.init());