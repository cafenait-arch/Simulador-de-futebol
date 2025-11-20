const App = {
    clubs: [], countries: [], competitions: [], competitionStages: [], competitionStageClubs: [],
    competitionStageTransitions: [], zipData: null, logoCache: new Map(), teamTitles: new Map(),
    seasonHistory: [], currentSeason: 0, currentCompetition: null, currentStage: null,
    standings: [], schedule: [], playoffBracket: [], 
    currentGroups: [], currentGroupIndex: 0, currentDivisions: [], currentDivisionIndex: 0,

    async loadDB() {
        await this.loadZip("Pack.zip");
        const dataDbFile = Object.values(this.zipData.files).find(f => f.name.toLowerCase().includes("data.db"));
        if (!dataDbFile) throw new Error("Arquivo data.db não encontrado no ZIP");
        const buffer = await dataDbFile.async("arraybuffer");
        const SQL = await initSqlJs({locateFile: () => "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql-wasm.wasm"});
        this.db = new SQL.Database(new Uint8Array(buffer));
        
        const getTable = tableName => this.db.exec(`SELECT * FROM ${tableName}`)[0]?.values || [];
        
        this.countries = getTable("Country").map(([id, name]) => ({ 
            id: id != null ? id.toString() : null, 
            name 
        })).filter(c => c.id != null);
        
        this.competitions = getTable("Competition").map(([id, countryId, name, type, importanceOrder, recurring, startMonth]) => ({
            id: id != null ? id.toString() : null, 
            countryId: countryId != null ? countryId.toString() : null, 
            name, 
            type: +type, 
            importanceOrder: +importanceOrder, 
            recurring: +recurring, 
            startMonth: +startMonth
        })).filter(c => c.id != null);
        
        this.clubs = getTable("Club").map(([id, name, rating, countryId, bTeamOf]) => ({
            id: id != null ? id.toString() : null, 
            name, 
            rating: +rating, 
            countryId: countryId != null ? countryId.toString() : null, 
            originalRating: +rating, 
            bTeamOf: bTeamOf ? bTeamOf.toString() : null,
            competitions: [],
            stages: [],
            originalCompetitions: [],
            originalStages: []
        })).filter(c => c.id != null);
        
        this.competitionStages = getTable("CompetitionStage").map(([id, competitionId, name, startingWeek, stageType, numLegs, numRounds, isLastStage, numGroups, allowByeTeamsOnDraw, numberOfTeams, duration, isWinnerDecisionStage]) => ({
            id: id != null ? id.toString() : null, 
            competitionId: competitionId != null ? competitionId.toString() : null,
            name, 
            startingWeek: +startingWeek,
            stageType: +stageType, 
            numLegs: +numLegs, 
            numRounds: +numRounds, 
            isLastStage: +isLastStage,
            numGroups: +numGroups, 
            allowByeTeamsOnDraw: +allowByeTeamsOnDraw, 
            numberOfTeams: +numberOfTeams, 
            duration: +duration, 
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
            
            club.competitions.forEach(compId => {
                const stagesDaCompeticao = this.competitionStages.filter(s => {
                    const stageCompIds = s.competitionId.split(',').map(id => id.trim());
                    return stageCompIds.includes(compId);
                });
                
                stagesDaCompeticao.forEach(stage => {
                    if (!club.stages.includes(stage.id)) {
                        club.stages.push(stage.id);
                    }
                });
            });
            
            club.originalCompetitions = [...club.competitions];
            club.originalStages = [...club.stages];
        });

        this.initializeTitles();
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
        this.setupTabs();
        this.populateSelects();
        this.setupEventListeners();
        document.getElementById("simulateNextSeasonBtn").style.display = 'block';
    },

    setupEventListeners() {
        [
            { id: "simulateBtn", event: "click", fn: () => this.simulate() },
            { id: "simulateSeasonBtn", event: "click", fn: () => this.simulateSeasons() },
            { id: "simulateNextSeasonBtn", event: "click", fn: () => this.simulateNextSeason() },
            { id: "viewSeason", event: "change", fn: () => this.viewSeason() },
            { id: "viewRound", event: "change", fn: () => this.viewRound() },
            { id: "viewCompetition", event: "change", fn: () => this.viewCompetition() },
            { id: "viewStage", event: "change", fn: () => this.viewStage() },
            { id: "groupPrev", event: "click", fn: () => this.changeGroup(-1) },
            { id: "groupNext", event: "click", fn: () => this.changeGroup(1) },
            { id: "divisionUp", event: "click", fn: () => this.changeDivision(-1) },
            { id: "divisionDown", event: "click", fn: () => this.changeDivision(1) },
            { id: "viewPlayoffBtn", event: "click", fn: () => this.togglePlayoffView() }
        ].forEach(({ id, event, fn }) => document.getElementById(id)?.addEventListener(event, fn));
    },

    setupTabs() {
        document.querySelectorAll(".tablink").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".tablink").forEach(t => t.classList.remove("active"));
                document.querySelectorAll(".tabcontent").forEach(c => c.style.display = "none");
                tab.classList.add("active");
                document.getElementById(tab.dataset.tab).style.display = "block";
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
        populate(document.getElementById("seasonCountry"), this.countries);
    },

    async simulateCompetition(competition, saveToSeason = false, sharedStageResults = new Map(), crossQualified = new Map()) {
        const stages = this.competitionStages.filter(s => {
            const competitionIds = s.competitionId.split(',').map(id => id.trim());
            return competitionIds.includes(competition.id);
        }).sort((a, b) => a.startingWeek - b.startingWeek);
        
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
            if (sharedStageResults.has(stage.id)) {
                const stageResult = sharedStageResults.get(stage.id);
                competitionResult.stages.push(stageResult);
                continue;
            }
            
            let teams = [];
            
            // Pega times base: ou qualificados de stage anterior, ou times que têm esse stage
            const baseTeams = qualifiedTeams.has(stage.id)
                ? qualifiedTeams.get(stage.id)
                : this.clubs.filter(club => club.stages.includes(stage.id));
            
            // Pega times injetados de outras competições via type 106
            const extraTeams = crossQualified.get(stage.id) || [];
            
            // Se não tem times base MAS tem times injetados, usa só os injetados
            // Se tem ambos, combina sem duplicar
            if (baseTeams.length === 0 && extraTeams.length > 0) {
                teams = extraTeams;
            } else {
                const unique = new Map();
                [...baseTeams, ...extraTeams].forEach(t => { if (t && !unique.has(t.id)) unique.set(t.id, t); });
                teams = Array.from(unique.values());
            }
            
            if (extraTeams.length) { 
                try { 
                    console.log("[Stage", stage.id, competition.name, "] injected via 106:", extraTeams.map(t=>t.name), "| Total teams:", teams.length); 
                } catch(_){} 
            }
            
            if (teams.length === 0) {
                continue;
            }
            
            const stageResult = await this.simulateStage(stage, teams);
            
            sharedStageResults.set(stage.id, stageResult);
            competitionResult.stages.push(stageResult);
            
            // Se foi um playoff, avança vencedores automaticamente para o próximo playoff stage
            if (stage.stageType === 1 && stageResult.playoffData?.winners?.length > 0) {
                const nextPlayoffStage = this.findNextPlayoffStage(stage, competition);
                if (nextPlayoffStage) {
                    if (!qualifiedTeams.has(nextPlayoffStage.id)) {
                        qualifiedTeams.set(nextPlayoffStage.id, []);
                    }
                    const currentTeams = qualifiedTeams.get(nextPlayoffStage.id);
                    stageResult.playoffData.winners.forEach(winner => {
                        const team = this.getClub(winner.id);
                        if (team && !currentTeams.find(t => t.id === team.id)) {
                            currentTeams.push(team);
                        }
                    });
                    console.log("[Playoff Auto-Advance]", stage.id, "→", nextPlayoffStage.id, "winners:", stageResult.playoffData.winners.map(w => w.name));
                }
            }
            
            const transitions = this.competitionStageTransitions.filter(t => t.stageIdFrom === stage.id);
            
            for (const transition of transitions) {
                let teamsToTransfer = [];
                
                if (transition.place === -1) {
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
                if (stage.stageType === 0 || stage.stageType === 2) {
                    competitionResult.championId = stageResult.standings?.[0]?.id || null;
                } else if (stage.stageType === 1 && stageResult.playoffBracket) {
                    const finalRound = stageResult.playoffBracket[stageResult.playoffBracket.length - 1];
                    if (finalRound.matches && finalRound.matches.length > 0) {
                        const winner = finalRound.matches[0].winner;
                        if (winner && !winner.isBye) {
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
        
        if (stage.stageType === 1) {
            const playoffData = await this.simulatePlayoff(teams, stage);
            stageResult.playoffBracket = playoffData.bracket;
            stageResult.playoffData = playoffData; // Armazena os dados completos incluindo winners
            stageResult.standings = this.getPlayoffTeamsInOrder(playoffData.bracket, playoffData.winners);
        }
        else if (stage.numGroups > 1) {
            stageResult.groups = await this.simulateGroupStage(teams, stage);
            stageResult.standings = this.consolidateGroupStandings(stageResult.groups);
        }
        else {
            stageResult.schedule = this.generateLeagueSchedule(teams, stage.numRounds || 2);
            this.initializeStandings(teams);
            
            for (const roundMatches of stageResult.schedule) {
                for (const match of roundMatches) {
                    await this.playMatch(match, stageResult.clubsStats);
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
                if (!match.isBye) {
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
                } else {
                    // Bye - time avança automaticamente
                    standings.push({
                        id: match.winner.id,
                        name: match.winner.name,
                        played: 0, won: 0, drawn: 0, lost: 0,
                        goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0,
                        playoffRound: 1,
                        qualified: true
                    });
                }
            });
        }
        
        return standings.sort((a, b) => {
            if (a.qualified && !b.qualified) return -1;
            if (!a.qualified && b.qualified) return 1;
            return b.points - a.points;
        });
    },

    findNextPlayoffStage(currentStage, competition) {
        // Encontra o próximo stage de playoff (stageType=1) com ID maior dentro da mesma competição
        const competitionIds = competition.id.split(',').map(id => id.trim());
        
        return this.competitionStages.find(stage => {
            if (stage.stageType !== 1) return false; // Deve ser playoff
            if (stage.id <= currentStage.id) return false; // Deve ter ID maior
            
            const stageCompIds = stage.competitionId.split(',').map(id => id.trim());
            const isInSameCompetition = stageCompIds.some(id => competitionIds.includes(id));
            
            return isInSameCompetition;
        });
    },

    getAllTeamsFromPlayoff(playoffBracket) {
        const teams = new Map();
        playoffBracket.forEach(round => {
            round.matches.forEach(match => {
                if (!match.team1.isBye) teams.set(match.team1.id, match.team1);
                if (!match.team2.isBye) teams.set(match.team2.id, match.team2);
            });
        });
        return Array.from(teams.values());
    },

    async simulateGroupStage(teams, stage) {
        const groups = [];
        const numGroups = stage.numGroups || 1;
        const teamsPerGroup = Math.floor(teams.length / numGroups);
        const numRounds = stage.numRounds || 2;
        
        const shuffledTeams = [...teams].sort(() => Math.random() - 0.5);
        
        for (let g = 0; g < numGroups; g++) {
            const groupTeams = shuffledTeams.slice(g * teamsPerGroup, (g + 1) * teamsPerGroup);
            const groupId = String.fromCharCode(65 + g);
            
            const group = {
                id: groupId,
                teams: groupTeams,
                standings: [],
                schedule: this.generateLeagueSchedule(groupTeams, numRounds)
            };
            
            this.initializeStandings(groupTeams);
            
            for (const roundMatches of group.schedule) {
                for (const match of roundMatches) {
                    const homeClub = this.getClub(match.home);
                    const awayClub = this.getClub(match.away);
                    if (!homeClub || !awayClub) continue;
                    
                    const homeExpected = this.calcExpectedGoals(homeClub.rating, awayClub.rating, true);
                    const awayExpected = this.calcExpectedGoals(awayClub.rating, homeClub.rating, false);
                    const homeScore = this.poisson(homeExpected);
                    const awayScore = this.poisson(awayExpected);
                    
                    Object.assign(match, { homeScore, awayScore, played: true });
                    this.updateStandings(homeClub.id, awayClub.id, homeScore, awayScore, homeExpected, awayExpected);
                }
            }
            
            this.sortStandings();
            group.standings = JSON.parse(JSON.stringify(this.standings));
            groups.push(group);
        }
        
        return groups;
    },

    async simulatePlayoff(teams, stage) {
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
        
        for (let i = 0; i < shuffledTeams.length; i += 2) {
            if (i + 1 >= shuffledTeams.length) {
                // Time ímpar avança automaticamente (bye)
                winners.push(shuffledTeams[i]);
                continue;
            }
            
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
            
            const homeExpected1 = this.calcExpectedGoals(club1.rating, club2.rating, true);
            const awayExpected1 = this.calcExpectedGoals(club2.rating, club1.rating, false);
            const homeScore1 = this.poisson(homeExpected1);
            const awayScore1 = this.poisson(awayExpected1);
            aggregateHome += homeScore1;
            aggregateAway += awayScore1;
            
            let homeScore2 = 0;
            let awayScore2 = 0;
            if (numLegs > 1) {
                const homeExpected2 = this.calcExpectedGoals(club2.rating, club1.rating, true);
                const awayExpected2 = this.calcExpectedGoals(club1.rating, club2.rating, false);
                homeScore2 = this.poisson(homeExpected2);
                awayScore2 = this.poisson(awayExpected2);
                aggregateHome += awayScore2;
                aggregateAway += homeScore2;
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
                numLegs: numLegs
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
                        if (!match.team1.isBye) allTeams.set(match.team1.id, match.team1);
                        if (!match.team2.isBye) allTeams.set(match.team2.id, match.team2);
                    });
                });
                return Array.from(allTeams.values());
            }
            
            const qualified = [];
            
            // Na nova estrutura, cada playoff stage é uma rodada única
            // Position 1 = vencedores (avançam)
            // Position 2+ = perdedores (eliminados)
            if (position === 1) {
                // Retorna todos os vencedores
                playoffBracket.forEach(round => {
                    round.matches.forEach(match => {
                        if (match.winner && !match.winner.isBye && !qualified.find(q => q.id === match.winner.id)) {
                            qualified.push(match.winner);
                        }
                    });
                });
            }
            else {
                // Retorna todos os perdedores
                playoffBracket.forEach(round => {
                    round.matches.forEach(match => {
                        if (!match.isBye && match.winner) {
                            const loser = match.winner.id === match.team1.id ? match.team2 : match.team1;
                            if (loser && !loser.isBye && !qualified.find(q => q.id === loser.id)) {
                                qualified.push(loser);
                            }
                        }
                    });
                });
            }
            
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
                    if (!match.team1.isBye) allTeams.set(match.team1.id, match.team1);
                    if (!match.team2.isBye) allTeams.set(match.team2.id, match.team2);
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

    async playMatch(match, clubsStats) {
        const homeClub = this.getClub(match.home);
        const awayClub = this.getClub(match.away);
        if (!homeClub || !awayClub) return;
        
        const homeExpected = this.calcExpectedGoals(homeClub.rating, awayClub.rating, true);
        const awayExpected = this.calcExpectedGoals(awayClub.rating, homeClub.rating, false);
        const homeScore = this.poisson(homeExpected);
        const awayScore = this.poisson(awayExpected);
        
        Object.assign(match, { homeScore, awayScore, played: true });
        this.updateStandings(homeClub.id, awayClub.id, homeScore, awayScore, homeExpected, awayExpected);
        
        const homeStats = clubsStats.find(s => s.id === match.home);
        const awayStats = clubsStats.find(s => s.id === match.away);
        if (homeStats) {
            homeStats.expectedGoalsFor += homeExpected;
            homeStats.expectedGoalsAgainst += awayExpected;
            homeStats.actualGoalsFor += homeScore;
            homeStats.actualGoalsAgainst += awayScore;
            if (awayScore === 0) homeStats.cleanSheets++;
        }
        if (awayStats) {
            awayStats.expectedGoalsFor += awayExpected;
            awayStats.expectedGoalsAgainst += homeExpected;
            awayStats.actualGoalsFor += awayScore;
            awayStats.actualGoalsAgainst += homeScore;
            if (homeScore === 0) awayStats.cleanSheets++;
        }
    },

    generateLeagueSchedule(teams, numRounds) {
        const teamIds = teams.map(t => t.id);
        if (teamIds.length % 2 !== 0) teamIds.push("BYE");
        const numTeams = teamIds.length;
        const schedule = [];
        let rotation = [...teamIds];
        const matchesPerRound = Math.floor(numTeams / 2);
        const totalRounds = (numTeams - 1) * numRounds;

        for (let r = 0; r < totalRounds; r++) {
            const matches = [];
            for (let i = 0; i < matchesPerRound; i++) {
                const homeIndex = i, awayIndex = numTeams - 1 - i;
                const isHome = r % 2 === 0;
                const home = isHome ? rotation[homeIndex] : rotation[awayIndex];
                const away = isHome ? rotation[awayIndex] : rotation[homeIndex];
                if (home !== "BYE" && away !== "BYE") {
                    matches.push({ 
                        home, away, homeScore: 0, awayScore: 0, 
                        played: false, round: r + 1 
                    });
                }
            }
            schedule.push(matches);
            rotation = [rotation[0], rotation[numTeams - 1], ...rotation.slice(1, numTeams - 1)];
        }
        return schedule;
    },

    updateRatingsFromStats(clubsStats) {
        clubsStats.forEach(stats => {
            const club = this.getClub(stats.id);
            if (club && stats.expectedGoalsFor + stats.expectedGoalsAgainst > 0) {
                const performanceBonus = (stats.actualGoalsFor - stats.expectedGoalsFor) - 
                                       (stats.actualGoalsAgainst - stats.expectedGoalsAgainst);
                const approxGames = Math.max(1, (stats.expectedGoalsFor + stats.expectedGoalsAgainst) / 2.3);
                const normalizedBonus = performanceBonus / approxGames;
                club.rating = Math.min(95, Math.max(1, stats.currentRating + normalizedBonus * 2));
                stats.currentRating = club.rating;
            }
        });
    },

    getClub(id) { 
        return this.clubs.find(c => c.id === id); 
    },

    async loadLogo(id) {
        if (this.logoCache.has(id)) return this.logoCache.get(id);
        if (!this.zipData) return "";
        try {
            const file = this.zipData.file(`club_logos/${id}.png`);
            if (!file) return "";
            const blob = await file.async("blob");
            const url = URL.createObjectURL(blob);
            this.logoCache.set(id, url); 
            return url;
        } catch (e) { 
            return ""; 
        }
    },

    poisson(lambda) {
        if (lambda <= 0) return 0;
        let L = Math.exp(-lambda), k = 0, p = 1;
        while (p > L) { k++; p *= Math.random(); }
        return k - 1;
    },

    calcExpectedGoals(teamRating, oppRating, isHome = false) {
        const F = 2.5;
        const atk = teamRating + (isHome ? F : 0);
        const def = oppRating + (isHome ? 0 : F);
        const diff = atk - def;
        return Math.max(1.2 + 0.06 * Math.sign(diff) * (Math.abs(diff) ** 1.2), 0.1);
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

    async simulateSingleSeason() {
        const countryId = document.getElementById("seasonCountry").value;
        if (!countryId) {
            alert("Por favor, selecione um país.");
            return null;
        }
this.resetContinentalQualifications();
        const countryCompetitions = this.competitions
            .filter(c => c.countryId === countryId)
            .sort((a, b) => a.importanceOrder - b.importanceOrder);
        
        if (countryCompetitions.length === 0) {
            alert("Nenhuma competição encontrada para este país.");
            return null;
        }
        
        const seasonResult = {
            season: this.seasonHistory.length + 1,
            competitions: [],
            year: new Date().getFullYear() + this.seasonHistory.length
        };
        
        const sharedStageResults = new Map();
        const crossQualified = new Map();
        
        for (const competition of countryCompetitions) {
            let competitionResult;
            if (competition.type === 0) {
                const clubs = this.clubs.filter(c => c.competitions.includes(competition.id));
                if (clubs.length === 0) {
                    continue;
                }
                
                competitionResult = await this.simulateSimpleLeague(clubs, competition, true, sharedStageResults, crossQualified);
            } else {
                competitionResult = await this.simulateCompetition(competition, true, sharedStageResults, crossQualified);
            }
            
            if (competitionResult) {
                seasonResult.competitions.push(competitionResult);
            }
        }
        
        if (seasonResult.competitions.length === 0) {
            alert("Nenhuma competição pôde ser simulada.");
            return null;
        }
        
        this.applyPromotionsAndRelegations(seasonResult);
        this.seasonHistory.push(seasonResult);
        
        return seasonResult;
    },

    async simulateSimpleLeague(clubs, competition, saveToSeason = false, sharedStageResults = new Map(), crossQualified = new Map()) {
        const mainStage = this.competitionStages.find(s =>
            s.competitionId.split(',').map(id => id.trim()).includes(competition.id) && s.isLastStage
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
        
        const baseStageClubs = this.clubs.filter(club => club.stages.includes(mainStage.id));
        const extra = crossQualified.get(mainStage.id) || [];
        const uniqueMap = new Map();
        [...baseStageClubs, ...extra].forEach(t => { if (t && !uniqueMap.has(t.id)) uniqueMap.set(t.id, t); });
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

    processTransition(competition, stage, transition, standings, groups, playoffBracket) {
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
        const eligibleTeams = [];
        let currentPosition = transition.place;
        const maxPositions = this.getMaxPositions(standings, groups);
        
        while (eligibleTeams.length < originalTeams.length && currentPosition <= maxPositions) {
            const teamsAtPosition = this.getTeamsByPosition(null, currentPosition, standings, groups);
            
            teamsAtPosition.forEach(teamData => {
                if (eligibleTeams.length < originalTeams.length) {
                    const club = this.getClub(teamData.id);
                    const targetStage = this.competitionStages.find(s => s.id === transition.stageIdTo);
                    
                    if (club && targetStage && this.isTeamEligibleForTransition(club, targetStage, transition, currentCompetition)) {
                        if (!eligibleTeams.find(t => t.id === teamData.id)) {
                            eligibleTeams.push(teamData);
                        }
                    }
                }
            });
            
            currentPosition++;
        }
        
        return eligibleTeams;
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
            const index = club.competitions.indexOf(compId);
            if (index !== -1) {
                club.competitions.splice(index, 1);
            }
            
            const stagesToRemove = this.competitionStages
                .filter(s => s.competitionId.split(',').map(id => id.trim()).includes(compId))
                .map(s => s.id);
            
            stagesToRemove.forEach(stageId => {
                const stageIndex = club.stages.indexOf(stageId);
                if (stageIndex !== -1) {
                    club.stages.splice(stageIndex, 1);
                }
            });
        });
        
        targetCompetitionIds.forEach(compId => {
            if (!club.competitions.includes(compId)) {
                club.competitions.push(compId);
            }
        });
        
        if (!club.stages.includes(targetStage.id)) {
            club.stages.push(targetStage.id);
        }
    },
    
    handleContinentalQualification(club, targetStage, targetCompetitionIds) {
        targetCompetitionIds.forEach(compId => {
            if (!club.competitions.includes(compId)) {
                club.competitions.push(compId);
            }
        });
        
        if (!club.stages.includes(targetStage.id)) {
            club.stages.push(targetStage.id);
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
        });
        
        if (!club.stages.includes(targetStage.id)) {
            club.stages.push(targetStage.id);
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
    const countryId = document.getElementById("seasonCountry").value;
    if (!countryId) return;
    
    // Identificar apenas transições do Type 100 (competições continentais)
    const continentalTransitions = this.competitionStageTransitions.filter(t => t.type === 100);
    
    // Pegar apenas os stages destino das transições Type 100
    const continentalStageIds = continentalTransitions.map(t => t.stageIdTo);
    
    // Pegar as competições associadas a esses stages
    const continentalCompIds = [];
    continentalStageIds.forEach(stageId => {
        const stage = this.competitionStages.find(s => s.id === stageId);
        if (stage) {
            const compIds = stage.competitionId.split(',').map(id => id.trim());
            compIds.forEach(compId => {
                if (!continentalCompIds.includes(compId)) {
                    continentalCompIds.push(compId);
                }
            });
        }
    });
    
    // Remover APENAS as competições e stages continentais do Type 100
    this.clubs.forEach(club => {
        // Remover competições continentais Type 100
        club.competitions = club.competitions.filter(compId =>
            !continentalCompIds.includes(compId)
        );
        
        // Remover stages continentais Type 100  
        club.stages = club.stages.filter(stageId =>
            !continentalStageIds.includes(stageId)
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
            alert("Times não encontrados.");
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

    async simulateSeasons() {
        const button = document.getElementById("simulateSeasonBtn"); 
        if (button.disabled) return;
        
        button.disabled = true;
        const originalText = button.textContent;
        
        try {
            this.initializeTitles();
            this.clubs.forEach(club => { 
                club.rating = club.originalRating; 
                club.competitions = [...club.originalCompetitions];
                club.stages = [...club.originalStages];
            });
            
            const numSeasons = parseInt(document.getElementById("numSeasons").value); 
            if (numSeasons < 1 || numSeasons > 100) {
                alert("Número de temporadas inválido. Use entre 1 e 100.");
                return;
            }
            
            this.seasonHistory = []; 
            this.currentSeason = 0;
            
            const progressContainer = document.getElementById("seasonProgress") || (() => { 
                const div = document.createElement("div"); 
                div.id = "seasonProgress"; 
                div.style.padding = "10px";
                div.style.backgroundColor = "#f0f0f0";
                div.style.marginBottom = "10px";
                div.style.borderRadius = "5px";
                div.style.textAlign = "center";
                div.style.fontWeight = "bold";
                document.getElementById("season").prepend(div); 
                return div; 
            })();
            
            for (let season = 1; season <= numSeasons; season++) {
                this.currentSeason = season; 
                button.textContent = `Simulando... (${season}/${numSeasons})`;
                
                const seasonResult = await this.simulateSingleSeason();
                if (!seasonResult) {
                    alert(`Erro ao simular temporada ${season}. Parando simulação.`);
                    break;
                }
                
                const percent = ((season / numSeasons) * 100).toFixed(1); 
                progressContainer.textContent = `Temporada ${season}/${numSeasons} completa — ${percent}%`;
                progressContainer.style.backgroundColor = season % 2 === 0 ? "#e8f5e8" : "#f0f0f0";
                
                await new Promise(r => setTimeout(r, 100));
            }
            
            this.updateSeasonSelects();
            if (this.seasonHistory.length > 0) {
                const seasonSelector = document.getElementById("viewSeason"); 
                seasonSelector.value = this.seasonHistory.length; 
                this.viewSeason(this.seasonHistory.length);
            }
            
            progressContainer.textContent = `✅ Simulação concluída - ${this.seasonHistory.length} temporadas simuladas`;
            progressContainer.style.backgroundColor = "#d4edda";
            progressContainer.style.color = "#155724";
            
        } catch (error) {
            console.error("Erro na simulação:", error);
            alert(`Erro durante a simulação: ${error.message}`);
        } finally { 
            button.disabled = false; 
            button.textContent = originalText;
        }
    },

    async simulateNextSeason() {
        const button = document.getElementById("simulateNextSeasonBtn"); 
        if (button.disabled) return;
        
        button.disabled = true;
        try {
            const nextSeason = this.seasonHistory.length + 1; 
            this.currentSeason = nextSeason;
            const seasonResult = await this.simulateSingleSeason();
            if (seasonResult) { 
                this.updateSeasonSelects(); 
                const seasonSelector = document.getElementById("viewSeason"); 
                seasonSelector.value = nextSeason; 
                this.viewSeason(nextSeason); 
                
                const progressContainer = document.getElementById("seasonProgress");
                if (progressContainer) {
                    progressContainer.textContent = `✅ Temporada ${nextSeason} simulada com sucesso`;
                    progressContainer.style.backgroundColor = "#d4edda";
                }
            }
        } finally { 
            button.disabled = false; 
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
    },

    viewSeason(seasonNumber = null) {
        const selector = document.getElementById("viewSeason"); 
        const season = seasonNumber || parseInt(selector.value);
        
        if (!season || isNaN(season) || season < 1 || season > this.seasonHistory.length) {
            document.getElementById("seasonResults").innerHTML = "<p>Selecione uma temporada válida</p>";
            return;
        }
        
        const seasonData = this.seasonHistory[season - 1];
        if (!seasonData || !seasonData.competitions || seasonData.competitions.length === 0) {
            document.getElementById("seasonResults").innerHTML = "<p>Nenhum dado disponível para esta temporada</p>";
            return;
        }
        
        this.currentSeason = season;
        this.currentDivisions = seasonData.competitions.map(c => c.competition)
            .sort((a, b) => a.importanceOrder - b.importanceOrder);
        this.currentDivisionIndex = 0;
        
        this.updateCompetitionSelect(seasonData);
        this.updateDivisionDisplay();
        document.getElementById("seasonDivisionSelector").style.display = 'block';
        
        this.viewCompetition();
    },

    updateCompetitionSelect(seasonData) {
        const competitionSelect = document.getElementById("viewCompetition");
        competitionSelect.innerHTML = '<option value="" disabled selected>Selecione a Competição</option>';
        
        seasonData.competitions.forEach(compData => {
            const option = document.createElement("option");
            option.value = compData.competition.id;
            option.textContent = `${compData.competition.name} (D${compData.competition.importanceOrder})`;
            competitionSelect.appendChild(option);
        });
        
        document.getElementById("competitionSelector").style.display = 'block';
        this.hideAllViewSelectors();
    },

    hideAllViewSelectors() {
        document.getElementById("roundSelector").style.display = 'none';
        document.getElementById("groupSelector").style.display = 'none';
        document.getElementById("viewPlayoffBtn").style.display = 'none';
    },

    viewCompetition() {
        const competitionId = document.getElementById("viewCompetition").value;
        if (!competitionId) return;
        
        const seasonData = this.seasonHistory[this.currentSeason - 1];
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
        
        if (this.schedule && this.schedule.length > 0) {
            for (let i = 1; i <= this.schedule.length; i++) {
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
        await this.displayRoundMatches(round, "seasonMatches"); 
    },

    changeDivision(direction) {
        const newIndex = this.currentDivisionIndex + direction;
        if (newIndex >= 0 && newIndex < this.currentDivisions.length) { 
            this.currentDivisionIndex = newIndex; 
            this.updateDivisionDisplay(); 
            this.viewSeason(); 
        }
    },

    updateDivisionDisplay() {
        const display = document.getElementById("divisionDisplay");
        const upBtn = document.getElementById("divisionUp");
        const downBtn = document.getElementById("divisionDown");
        
        if (this.currentDivisions.length > 0) {
            const currentDivision = this.currentDivisions[this.currentDivisionIndex]; 
            display.textContent = `D${currentDivision.importanceOrder}`;
            upBtn.disabled = this.currentDivisionIndex === 0;
            downBtn.disabled = this.currentDivisionIndex === this.currentDivisions.length - 1;
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
    const table = document.createElement("table");
    table.className = "standings-table";
    table.innerHTML = `
        <tr>
            <th>#</th><th>Time</th><th>J</th><th>V</th><th>E</th><th>D</th>
            <th>GP</th><th>GC</th><th>SG</th><th>Pts</th>
        </tr>
    `;
    
    const transitions = this.getRelevantTransitions();
    
    const rows = await Promise.all(this.standings.map(async (team, index) => {
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
        `;
        return tr;
    }));
    
    rows.forEach(r => table.appendChild(r));
    container.appendChild(table);
},

async displayGroupStandings(container) {
    if (this.currentGroups.length === 0) return;
    
    const currentGroup = this.currentGroups[this.currentGroupIndex];
    if (!currentGroup || !currentGroup.standings) return;
    
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
            <th>GP</th><th>GC</th><th>SG</th><th>Pts</th>
        </tr>
    `;
    
    const numQualified = this.currentStage?.stage?.numberOfClassifieds || 0;
    const transitions = this.getRelevantTransitions();
    
    const rows = await Promise.all(currentGroup.standings.map(async (team, index) => {
        const logo = await this.loadLogo(team.id);
        const tr = document.createElement("tr");
        tr.style.cursor = "pointer";
        tr.onclick = () => this.showTeamProfile(team.id);
        
        const position = index + 1;
        let positionClass = "";
        
        // Primeiro verifica as transições específicas
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
        
        // Se não houver transição específica, verifica a classificação padrão do grupo
        if (!positionClass && position <= numQualified) {
            positionClass = "promoted";
        }
        
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
        `;
        return tr;
    }));
    
    rows.forEach(r => table.appendChild(r));
    container.appendChild(table);
},

getRelevantTransitions() {
    if (!this.currentStage) return [];
    
    const transitions = this.competitionStageTransitions.filter(t =>
        t.stageIdFrom === this.currentStage.stage.id && (t.type === 0 || t.type === 106)
    );
    
    const relevantTransitions = [];
    
    // Encontrar as posições mais altas (promoção) e mais baixas (rebaixamento)
    const promotionPlaces = [];
    const relegationPlaces = [];
    const type106Places = []; // Para transições type 106
    
    transitions.forEach(transition => {
        if (transition.place > 0) {
            if (transition.type === 106) {
                // Transição type 106 - DarkRed
                type106Places.push(transition.place);
            } else if (transition.type === 0) {
                // Transição type 0 - lógica original
                const targetStage = this.competitionStages.find(s => s.id === transition.stageIdTo);
                if (targetStage) {
                    const targetCompetitionIds = targetStage.competitionId.split(',').map(id => id.trim());
                    const currentCompetition = this.currentCompetition.competition;
                    
                    let isPromotion = false;
                    let isRelegation = false;
                    
                    // Verificar cada competição de destino
                    targetCompetitionIds.forEach(targetCompId => {
                        const targetCompetition = this.competitions.find(c => c.id === targetCompId);
                        if (targetCompetition) {
                            if (targetCompetition.importanceOrder < currentCompetition.importanceOrder) {
                                isPromotion = true; // Vai para competição mais importante
                            } else if (targetCompetition.importanceOrder > currentCompetition.importanceOrder) {
                                isRelegation = true; // Vai para competição menos importante
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
    
    // Criar faixas para promoções (verde)
    if (promotionPlaces.length > 0) {
        const minPromotion = Math.min(...promotionPlaces);
        const maxPromotion = Math.max(...promotionPlaces);
        relevantTransitions.push({
            type: 1, // promoção
            placeStart: minPromotion,
            placeEnd: maxPromotion
        });
    }
    
    // Criar faixas para rebaixamentos (vermelho)
    if (relegationPlaces.length > 0) {
        const minRelegation = Math.min(...relegationPlaces);
        const maxRelegation = Math.max(...relegationPlaces);
        relevantTransitions.push({
            type: 2, // rebaixamento
            placeStart: minRelegation,
            placeEnd: maxRelegation
        });
    }
    
    // Criar faixas para type 106 (DarkRed)
    if (type106Places.length > 0) {
        const minType106 = Math.min(...type106Places);
        const maxType106 = Math.max(...type106Places);
        relevantTransitions.push({
            type: 106, // type 106
            placeStart: minType106,
            placeEnd: maxType106
        });
    }
    
    return relevantTransitions;
},

    async displayRoundMatches(round, containerId) {
        const container = document.getElementById(containerId);
        container.innerHTML = `<h3>Rodada ${round}</h3><div class="matches-list"></div>`;
        const matchesList = container.querySelector(".matches-list");
        
        if (this.currentGroups.length > 0) {
            await this.displayGroupRoundMatches(round, matchesList);
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

    async displayGroupRoundMatches(round, matchesList) {
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
                    if (match.isBye) continue;
                    
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
                    
                    if (match.isBye) {
                        const team1 = { name: match.team1.name, id: match.team1.id };
                        const team2 = { name: match.team2.name, id: match.team2.id };
                        const [team1Logo, team2Logo] = await Promise.all([
                            this.loadLogo(match.team1.id),
                            this.loadLogo(match.team2.id)
                        ]);
                        this.displayMatchResult(team1, team2, "BYE", "", team1Logo, team2Logo, matchDiv);
                    } else {
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
                    }
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
        
        this.loadLogo(teamId).then(logo => {
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
            
            const currentSeasonData = this.seasonHistory[this.currentSeason - 1];
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
            
            const profileHTML = `
            <div class="profile-buttons" style="display: flex; gap: 10px; margin-bottom: 20px;">
                <button id="viewTitlesBtn" class="btn btn-primary">Ver Títulos</button>
                <button id="viewTrajectoryBtn" class="btn btn-primary">Trajetória</button>
            </div>
<div style="text-align: center;">
    ${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${team.name}" class="logo"></div>` : ''} 
    ${team.name}
</div>
            <p><i class="fas fa-info-circle"></i> <strong>Tipo:</strong> ${teamRelation}</p>
            <p><i class="fas fa-flag"></i> <strong>País:</strong> ${country}</p>
            <p><i class="fas fa-trophy"></i> <strong>Competições:</strong> ${competitionsText}</p>
            <p><i class="fas fa-star"></i> <strong>Rating:</strong> ${team.originalRating.toFixed(1)}</p> <br>
            ${seasonStats ? `
                <p><i class="fas fa-chart-line"></i> <strong>Rating da Simulação:</strong> ${seasonStats.currentRating.toFixed(1)}</p>
            ` : ''}
        `;
            
            document.getElementById('profileContent').innerHTML = profileHTML;
            document.getElementById('teamProfile').style.display = 'block';
            
            document.getElementById('viewTitlesBtn').addEventListener('click', () => this.showTeamTitles(teamId));
            document.getElementById('viewTrajectoryBtn').addEventListener('click', () => this.showTeamTrajectory(teamId));
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
    }
};

document.addEventListener("DOMContentLoaded", () => App.init());