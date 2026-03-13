// =============================================
// === SAVE MANAGER — Serialização Binária Real ===
// =============================================
// Formato binário próprio (MessagePack-style) sem JSON intermediário.
// Tipos: null, bool, int (varint zigzag), float64, string (utf8+length), array, object, Map, Set

const SaveManager = {

    SAVE_MAGIC: [0x46, 0x42, 0x53, 0x56], // "FBSV"
    SAVE_VERSION: 3, // v3 = binário real

    // ====== TIPOS BINÁRIOS ======
    TYPE_NULL:    0x00,
    TYPE_FALSE:   0x01,
    TYPE_TRUE:    0x02,
    TYPE_INT:     0x03, // varint zigzag
    TYPE_FLOAT:   0x04, // float64
    TYPE_STRING:  0x05, // varint length + utf8 bytes
    TYPE_ARRAY:   0x06, // varint length + elements
    TYPE_OBJECT:  0x07, // varint numKeys + (key + value) pairs
    TYPE_MAP:     0x08, // varint numEntries + (key + value) pairs (preserves Map)
    TYPE_SET:     0x09, // varint length + elements (preserves Set)

    // ====== ENCODER ======
    _encBuf: null,
    _encPos: 0,

    _ensureCapacity(needed) {
        if (this._encPos + needed > this._encBuf.length) {
            const newSize = Math.max(this._encBuf.length * 2, this._encPos + needed + 65536);
            const newBuf = new Uint8Array(newSize);
            newBuf.set(this._encBuf);
            this._encBuf = newBuf;
        }
    },

    _writeByte(b) {
        this._ensureCapacity(1);
        this._encBuf[this._encPos++] = b;
    },

    // Varint encoding (unsigned, LEB128)
    _writeVarint(n) {
        n = n >>> 0; // ensure unsigned 32-bit
        while (n >= 0x80) {
            this._writeByte((n & 0x7F) | 0x80);
            n >>>= 7;
        }
        this._writeByte(n);
    },

    // Zigzag encoding for signed ints
    _writeSignedVarint(n) {
        const zigzag = (n << 1) ^ (n >> 31);
        this._writeVarint(zigzag >>> 0);
    },

    _writeFloat64(v) {
        this._ensureCapacity(8);
        const buf = new ArrayBuffer(8);
        new Float64Array(buf)[0] = v;
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < 8; i++) this._encBuf[this._encPos++] = bytes[i];
    },

    _writeString(s) {
        const encoded = this._textEncoder.encode(s);
        this._writeVarint(encoded.length);
        this._ensureCapacity(encoded.length);
        this._encBuf.set(encoded, this._encPos);
        this._encPos += encoded.length;
    },

    _writeBytes(bytes) {
        this._ensureCapacity(bytes.length);
        this._encBuf.set(bytes, this._encPos);
        this._encPos += bytes.length;
    },

    _textEncoder: new TextEncoder(),
    _textDecoder: new TextDecoder(),

    _encodeValue(val) {
        if (val === null || val === undefined) {
            this._writeByte(this.TYPE_NULL);
            return;
        }
        if (val === true) { this._writeByte(this.TYPE_TRUE); return; }
        if (val === false) { this._writeByte(this.TYPE_FALSE); return; }

        if (typeof val === 'number') {
            if (Number.isInteger(val) && val >= -2147483648 && val <= 2147483647) {
                this._writeByte(this.TYPE_INT);
                this._writeSignedVarint(val);
            } else {
                this._writeByte(this.TYPE_FLOAT);
                this._writeFloat64(val);
            }
            return;
        }

        if (typeof val === 'string') {
            this._writeByte(this.TYPE_STRING);
            this._writeString(val);
            return;
        }

        if (val instanceof Map) {
            this._writeByte(this.TYPE_MAP);
            this._writeVarint(val.size);
            val.forEach((v, k) => {
                this._encodeValue(k);
                this._encodeValue(v);
            });
            return;
        }

        if (val instanceof Set) {
            this._writeByte(this.TYPE_SET);
            this._writeVarint(val.size);
            val.forEach(v => this._encodeValue(v));
            return;
        }

        if (Array.isArray(val)) {
            this._writeByte(this.TYPE_ARRAY);
            this._writeVarint(val.length);
            for (let i = 0; i < val.length; i++) {
                this._encodeValue(val[i]);
            }
            return;
        }

        if (typeof val === 'object') {
            const keys = Object.keys(val);
            this._writeByte(this.TYPE_OBJECT);
            this._writeVarint(keys.length);
            for (const k of keys) {
                this._writeString(k);
                this._encodeValue(val[k]);
            }
            return;
        }

        // fallback: convert to string
        this._writeByte(this.TYPE_STRING);
        this._writeString(String(val));
    },

    encode(value) {
        this._encBuf = new Uint8Array(1024 * 256); // 256KB initial
        this._encPos = 0;
        this._encodeValue(value);
        return this._encBuf.slice(0, this._encPos);
    },

    // ====== DECODER ======
    _decBuf: null,
    _decPos: 0,

    _readByte() {
        return this._decBuf[this._decPos++];
    },

    _readVarint() {
        let result = 0;
        let shift = 0;
        let b;
        do {
            b = this._readByte();
            result |= (b & 0x7F) << shift;
            shift += 7;
        } while (b >= 0x80 && shift < 35);
        return result >>> 0;
    },

    _readSignedVarint() {
        const n = this._readVarint();
        return (n >>> 1) ^ -(n & 1);
    },

    _readFloat64() {
        const buf = new ArrayBuffer(8);
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < 8; i++) bytes[i] = this._decBuf[this._decPos++];
        return new Float64Array(buf)[0];
    },

    _readString() {
        const len = this._readVarint();
        const bytes = this._decBuf.subarray(this._decPos, this._decPos + len);
        this._decPos += len;
        return this._textDecoder.decode(bytes);
    },

    _decodeValue() {
        const type = this._readByte();

        switch (type) {
            case this.TYPE_NULL: return null;
            case this.TYPE_TRUE: return true;
            case this.TYPE_FALSE: return false;

            case this.TYPE_INT:
                return this._readSignedVarint();

            case this.TYPE_FLOAT:
                return this._readFloat64();

            case this.TYPE_STRING:
                return this._readString();

            case this.TYPE_ARRAY: {
                const len = this._readVarint();
                const arr = new Array(len);
                for (let i = 0; i < len; i++) arr[i] = this._decodeValue();
                return arr;
            }

            case this.TYPE_OBJECT: {
                const numKeys = this._readVarint();
                const obj = {};
                for (let i = 0; i < numKeys; i++) {
                    const key = this._readString();
                    obj[key] = this._decodeValue();
                }
                return obj;
            }

            case this.TYPE_MAP: {
                const size = this._readVarint();
                const map = new Map();
                for (let i = 0; i < size; i++) {
                    const k = this._decodeValue();
                    const v = this._decodeValue();
                    map.set(k, v);
                }
                return map;
            }

            case this.TYPE_SET: {
                const size = this._readVarint();
                const set = new Set();
                for (let i = 0; i < size; i++) set.add(this._decodeValue());
                return set;
            }

            default:
                throw new Error(`Tipo binário desconhecido: 0x${type.toString(16)} na posição ${this._decPos - 1}`);
        }
    },

    decode(uint8Array) {
        this._decBuf = uint8Array;
        this._decPos = 0;
        return this._decodeValue();
    },

    // ====== SERIALIZAÇÃO DO ESTADO ======

    // Helper: Convert Map to serializable object
    _mapToObj(map) {
        if (!map || !(map instanceof Map)) return {};
        const obj = {};
        map.forEach((v, k) => { obj[k] = v; });
        return obj;
    },

    _setToArr(set) {
        if (!set || !(set instanceof Set)) return [];
        return Array.from(set);
    },

    // Serialize seasonState — agora preserva Map/Set nativamente
    serializeSeasonState(ss) {
        if (!ss) return null;
        return {
            currentWeek: ss.currentWeek,
            totalWeeks: ss.totalWeeks,
            seasonComplete: ss.seasonComplete,
            weeklyPlan: ss.weeklyPlan || [],
            allCompetitions: ss.allCompetitions || [],
            seasonResult: ss.seasonResult || {},
            stageWindows: ss.stageWindows instanceof Map ? ss.stageWindows : new Map(Object.entries(ss.stageWindows || {})),
            stageStatus: ss.stageStatus instanceof Map ? ss.stageStatus : new Map(Object.entries(ss.stageStatus || {})),
            qualifiedTeams: ss.qualifiedTeams instanceof Map ? ss.qualifiedTeams : new Map(Object.entries(ss.qualifiedTeams || {})),
            crossQualified: ss.crossQualified instanceof Map ? ss.crossQualified : new Map(Object.entries(ss.crossQualified || {})),
            completedStages: ss.completedStages instanceof Set ? ss.completedStages : new Set(ss.completedStages || []),
            stageSchedules: ss.stageSchedules instanceof Map ? ss.stageSchedules : new Map(Object.entries(ss.stageSchedules || {})),
            sharedStageResults: ss.sharedStageResults instanceof Map ? ss.sharedStageResults : new Map(Object.entries(ss.sharedStageResults || {})),
            competitionResults: ss.competitionResults instanceof Map ? ss.competitionResults : new Map(Object.entries(ss.competitionResults || {})),
            competitionStagesMap: ss.competitionStagesMap instanceof Map ? ss.competitionStagesMap : new Map(Object.entries(ss.competitionStagesMap || {})),
        };
    },

    // Deserialize seasonState — dados já vêm como Map/Set do decoder binário
    deserializeSeasonState(raw) {
        if (!raw) return null;
        const ss = {};
        ss.currentWeek = raw.currentWeek || 0;
        ss.totalWeeks = raw.totalWeeks || 52;
        ss.seasonComplete = !!raw.seasonComplete;
        ss.weeklyPlan = raw.weeklyPlan || [];
        ss.allCompetitions = raw.allCompetitions || [];
        ss.seasonResult = raw.seasonResult || {};

        // O decoder binário já retorna Maps/Sets, mas precisamos garantir
        const ensureMap = (v) => (v instanceof Map) ? v : new Map(Object.entries(v || {}));
        const ensureSet = (v) => (v instanceof Set) ? v : new Set(v || []);

        ss.stageWindows = ensureMap(raw.stageWindows);
        ss.stageStatus = ensureMap(raw.stageStatus);
        ss.qualifiedTeams = ensureMap(raw.qualifiedTeams);
        ss.crossQualified = ensureMap(raw.crossQualified);
        ss.completedStages = ensureSet(raw.completedStages);
        ss.sharedStageResults = ensureMap(raw.sharedStageResults);
        ss.competitionResults = ensureMap(raw.competitionResults);
        ss.competitionStagesMap = ensureMap(raw.competitionStagesMap);
        ss.stageSchedules = ensureMap(raw.stageSchedules);

        return ss;
    },

    // Rebuild Map refs para manter sincronia entre Map e arrays
    rebuildStageScheduleRefs(seasonState) {
        if (!seasonState || !seasonState.stageSchedules) return;
        const schedules = seasonState.stageSchedules instanceof Map
            ? seasonState.stageSchedules
            : new Map(Object.entries(seasonState.stageSchedules || {}));

        schedules.forEach((data, stageId) => {
            if (data.clubsStats && Array.isArray(data.clubsStats)) {
                data.clubsStatsMap = new Map(data.clubsStats.map(s => [s.id, s]));
            }
            if (data.standingsRef && Array.isArray(data.standingsRef)) {
                data.standingsMapRef = new Map(data.standingsRef.map(s => [s.id, s]));
            }
            if (data.groups && Array.isArray(data.groups)) {
                data.groups.forEach(g => {
                    if (g.standingsRef && Array.isArray(g.standingsRef)) {
                        g.standingsMapRef = new Map(g.standingsRef.map(s => [s.id, s]));
                    }
                });
            }
        });
    },

    // ====== ESTADO COMPLETO ======

    getSerializableState(app) {
        const clubs = app.clubs.map(c => ({
            id: c.id,
            rating: c.rating,
            transferBalance: c.transferBalance,
            youth: c.youth,
            formation: c.formation || null,
            competitions: c.competitions ? [...c.competitions] : [],
            stages: c.stages ? [...c.stages] : [],
            originalCompetitions: c.originalCompetitions ? [...c.originalCompetitions] : [],
            originalStages: c.originalStages ? [...c.originalStages] : []
        }));

        const players = app.players.map(p => ({
            id: p.id,
            name: p.name ?? null,
            rating: p.rating != null ? p.rating : 0,
            ratingPotential: p.ratingPotential != null ? p.ratingPotential : 0,
            clubId: p.clubId || null,
            countryId: p.countryId ?? null,
            role: p.role || 0,
            dob: p.dob || 20000101,
            originalClubId: p.originalClubId ?? null,
            _generated: !!p._generated
        }));

        const titles = {};
        if (app.teamTitles && app.teamTitles.forEach) {
            app.teamTitles.forEach((val, key) => {
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

        const formations = {};
        if (app.clubFormations && app.clubFormations.forEach) {
            app.clubFormations.forEach((val, key) => {
                if (key != null) formations[key] = val;
            });
        }

        const injections = {};
        if (app.nextSeasonInjections && app.nextSeasonInjections.forEach) {
            app.nextSeasonInjections.forEach((clubList, stageId) => {
                if (stageId != null && Array.isArray(clubList)) {
                    injections[stageId] = clubList.filter(c => c && c.id).map(c => c.id);
                }
            });
        }

        const trajectories = {};
        if (app.teamTrajectories && app.teamTrajectories.forEach) {
            app.teamTrajectories.forEach((arr, teamId) => {
                if (teamId != null) trajectories[teamId] = arr;
            });
        }

        const history = JSON.parse(JSON.stringify(app.seasonHistory || []));
        const stats = JSON.parse(JSON.stringify(app.playerStats || []));

        let weeklyState = null;
        if (app.seasonInProgress && app.seasonState) {
            weeklyState = this.serializeSeasonState(app.seasonState);
        }

        return {
            clubs, players, titles, formations, injections, trajectories, history, stats,
            currentSeason: app.currentSeason || 0,
            seasonInProgress: !!app.seasonInProgress,
            weeklyState,
            standings: JSON.parse(JSON.stringify(app.standings || [])),
            schedule: JSON.parse(JSON.stringify(app.schedule || [])),
            playoffBracket: JSON.parse(JSON.stringify(app.playoffBracket || [])),
            currentGroups: JSON.parse(JSON.stringify(app.currentGroups || [])),
            currentGroupIndex: app.currentGroupIndex || 0,
            currentDivisions: JSON.parse(JSON.stringify(app.currentDivisions || [])),
            currentDivisionIndex: app.currentDivisionIndex || 0,
            currentCompetition: app.currentCompetition ? JSON.parse(JSON.stringify(app.currentCompetition)) : null,
            currentStage: app.currentStage ? JSON.parse(JSON.stringify(app.currentStage)) : null,
            currentSeasonPreview: app.currentSeasonPreview ? JSON.parse(JSON.stringify(app.currentSeasonPreview)) : null,
            saveVersion: 3
        };
    },

    restoreState(app, state) {
        if (state.clubs) {
            const clubMap = new Map(app.clubs.map(c => [c.id, c]));
            state.clubs.forEach(saved => {
                if (!saved || !saved.id) return;
                const club = clubMap.get(saved.id);
                if (!club) return;
                if (saved.rating != null) club.rating = saved.rating;
                if (saved.transferBalance != null) club.transferBalance = saved.transferBalance;
                if (saved.youth != null) club.youth = saved.youth;
                if (saved.formation != null) club.formation = saved.formation;
                if (Array.isArray(saved.competitions)) club.competitions = [...saved.competitions];
                if (Array.isArray(saved.stages)) club.stages = [...saved.stages];
                if (Array.isArray(saved.originalCompetitions)) {
                    club.originalCompetitions = [...saved.originalCompetitions];
                } else if (Array.isArray(saved.competitions)) {
                    club.originalCompetitions = [...saved.competitions];
                }
                if (Array.isArray(saved.originalStages)) {
                    club.originalStages = [...saved.originalStages];
                } else if (Array.isArray(saved.stages)) {
                    club.originalStages = [...saved.stages];
                }
            });
        }

        if (state.players) {
            const savedPlayers = state.players.filter(s => s && s.id != null);
            const savedIds = new Set(savedPlayers.map(s => s.id));
            app.players = app.players.filter(p => savedIds.has(p.id));
            const playerMap = new Map(app.players.map(p => [p.id, p]));

            savedPlayers.forEach(saved => {
                let player = playerMap.get(saved.id);
                if (player) {
                    if (saved.name !== undefined) player.name = saved.name;
                    if (saved.rating != null) player.rating = saved.rating;
                    if (saved.ratingPotential != null) player.ratingPotential = saved.ratingPotential;
                    player.clubId = saved.clubId || null;
                    if (saved.countryId !== undefined) player.countryId = saved.countryId;
                    if (saved.role != null) player.role = saved.role;
                    if (saved.dob != null) player.dob = saved.dob;
                    if (saved.originalClubId !== undefined) player.originalClubId = saved.originalClubId;
                    if (saved._generated !== undefined) player._generated = !!saved._generated;
                } else {
                    const newPlayer = {
                        id: saved.id,
                        name: saved.name || ('Jogador ' + saved.id),
                        rating: Math.round(saved.rating || 0),
                        ratingPotential: Math.round(saved.ratingPotential || 0),
                        clubId: saved.clubId || null,
                        countryId: saved.countryId || null,
                        role: saved.role || 0,
                        dob: saved.dob || 20000101,
                        originalClubId: saved.originalClubId || null,
                        _generated: !!saved._generated
                    };
                    app.players.push(newPlayer);
                    playerMap.set(newPlayer.id, newPlayer);
                }
            });
        }

        if (state.titles) {
            app.teamTitles = new Map();
            Object.entries(state.titles).forEach(([clubId, champs]) => {
                const championships = new Map();
                Object.entries(champs).forEach(([compId, count]) => {
                    championships.set(compId, count);
                });
                app.teamTitles.set(clubId, { championships });
            });
        }

        if (state.trajectories) {
            app.teamTrajectories = new Map();
            Object.entries(state.trajectories).forEach(([teamId, arr]) => {
                app.teamTrajectories.set(teamId, arr);
            });
        }

        if (state.formations) {
            app.clubFormations = new Map();
            Object.entries(state.formations).forEach(([key, val]) => {
                app.clubFormations.set(key, val);
            });
        }

        if (state.injections) {
            app.nextSeasonInjections = new Map();
            Object.entries(state.injections).forEach(([stageId, clubIds]) => {
                const clubs = clubIds.map(id => app.clubs.find(c => c.id === id)).filter(Boolean);
                if (clubs.length > 0) app.nextSeasonInjections.set(stageId, clubs);
            });
        }

        if (state.stats) app.playerStats = state.stats;
        if (state.history) app.seasonHistory = state.history;
        app.currentSeason = state.currentSeason || app.seasonHistory.length;
        app.rejectedOffers = [];

        if (state.seasonInProgress && state.weeklyState) {
            app.seasonState = this.deserializeSeasonState(state.weeklyState);
            app.seasonInProgress = true;
            this.rebuildStageScheduleRefs(app.seasonState);
        } else {
            app.seasonState = null;
            app.seasonInProgress = false;
        }
        app.currentSeasonPreview = state.currentSeasonPreview || null;
        app.standings = state.standings || [];
        app.schedule = state.schedule || [];
        app.playoffBracket = state.playoffBracket || [];
        app.currentGroups = state.currentGroups || [];
        app.currentGroupIndex = state.currentGroupIndex || 0;
        app.currentDivisions = state.currentDivisions || [];
        app.currentDivisionIndex = state.currentDivisionIndex || 0;
        app.currentCompetition = state.currentCompetition || null;
        app.currentStage = state.currentStage || null;

        app.buildClubsMap();
        app.playersMap = new Map(app.players.map(p => [p.id, p]));
        app.invalidatePlayerCache();

        if (app.seasonInProgress && app.seasonState && !app.currentSeasonPreview) {
            app.currentSeasonPreview = app.buildCurrentSeasonPreview();
        }
    },

    // ====== EXPORT / IMPORT BINÁRIO REAL ======

    async exportSave(app) {
        const state = this.getSerializableState(app);
        const payload = this.encode(state);

        // Header: FBSV (4) + version (2) + seasonCount (4) + uncompressedSize (4) = 14
        const header = new Uint8Array(14);
        const headerView = new DataView(header.buffer);
        this.SAVE_MAGIC.forEach((b, i) => headerView.setUint8(i, b));
        headerView.setUint16(4, this.SAVE_VERSION, true);
        headerView.setUint32(6, (app.seasonHistory || []).length, true);
        headerView.setUint32(10, payload.byteLength, true);

        // Comprimir payload binário com gzip
        const compressed = await this._compress(payload);

        const result = new Uint8Array(header.byteLength + compressed.byteLength);
        result.set(header, 0);
        result.set(compressed, header.byteLength);
        return result.buffer;
    },

    async importSave(buffer) {
        const view = new DataView(buffer);
        for (let i = 0; i < 4; i++) {
            if (view.getUint8(i) !== this.SAVE_MAGIC[i]) {
                throw new Error('Arquivo .bin inválido: magic bytes incorretos');
            }
        }
        const version = view.getUint16(4, true);
        const seasonCount = view.getUint32(6, true);

        const compressed = new Uint8Array(buffer, 14);
        const decompressed = await this._decompress(compressed);

        let state;
        if (version >= 3) {
            // v3+: binário real
            state = this.decode(decompressed);
        } else {
            // v1/v2: JSON legado
            const json = this._textDecoder.decode(decompressed);
            state = JSON.parse(json);
        }

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
        }
        return data;
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
        }
        return data;
    },

    // ====== IndexedDB ======

    _activeSaveSlot: null,
    IDB_NAME: 'FootballSimSaves',
    IDB_VERSION: 1,
    IDB_STORE: 'saves',

    _openIDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(this.IDB_NAME, this.IDB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(this.IDB_STORE)) {
                    db.createObjectStore(this.IDB_STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    async idbGetAll() {
        const db = await this._openIDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.IDB_STORE, 'readonly');
            const store = tx.objectStore(this.IDB_STORE);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    },

    async idbPut(record) {
        const db = await this._openIDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.IDB_STORE, 'readwrite');
            const store = tx.objectStore(this.IDB_STORE);
            const req = store.put(record);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    async idbDelete(id) {
        const db = await this._openIDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.IDB_STORE, 'readwrite');
            const store = tx.objectStore(this.IDB_STORE);
            const req = store.delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    // ====== SAVE SLOT UI ======

    async showSaveSlotModal(app) {
        const modal = document.getElementById('saveSlotModal');
        const list = document.getElementById('saveSlotList');
        const saves = await this.idbGetAll();
        list.innerHTML = '';
        if (saves.length === 0) {
            list.innerHTML = '<p style="text-align:center;color:#aaa;">Nenhum save encontrado.</p>';
        } else {
            saves.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            saves.forEach(s => {
                const div = document.createElement('div');
                div.className = 'save-slot-item';
                const date = s.updatedAt ? new Date(s.updatedAt).toLocaleString('pt-BR') : 'N/A';
                const seasonNum = s.season || 0;
                div.innerHTML = `<div class="slot-info" onclick="App.loadSaveSlot('${s.id}')"><div class="slot-name">${s.name}</div><div class="slot-meta">Temporada ${seasonNum} &bull; ${date}</div></div><button class="slot-delete" onclick="event.stopPropagation();App.deleteSaveSlot('${s.id}')">Excluir</button>`;
                list.appendChild(div);
            });
        }
        modal.style.display = 'flex';
    },

    closeSaveSlotModal(skipLoad) {
        document.getElementById('saveSlotModal').style.display = 'none';
        if (skipLoad) this._activeSaveSlot = '__none__';
    },

    async createNewSave(app) {
        const name = prompt('Nome do save:');
        if (!name || !name.trim()) return;
        const id = 'save_' + Date.now();
        this._activeSaveSlot = id;
        await this.idbPut({ id, name: name.trim(), data: null, season: 0, updatedAt: Date.now() });
        this.closeSaveSlotModal();
        const progress = document.getElementById('seasonProgress');
        if (progress) { progress.innerHTML = `<span style="color:#4ade80;">Save "${name.trim()}" criado!</span>`; progress.style.display = 'block'; }
    },

    async loadSaveSlot(app, id) {
        const saves = await this.idbGetAll();
        const save = saves.find(s => s.id === id);
        if (!save) { alert('Save não encontrado.'); return; }
        this._activeSaveSlot = id;
        this.closeSaveSlotModal();
        if (save.data) {
            try {
                const uint8 = new Uint8Array(save.data);
                let state;
                if (uint8[0] === this.SAVE_MAGIC[0] && uint8[1] === this.SAVE_MAGIC[1] &&
                    uint8[2] === this.SAVE_MAGIC[2] && uint8[3] === this.SAVE_MAGIC[3]) {
                    const imported = await this.importSave(save.data.buffer || save.data);
                    state = imported.state;
                } else {
                    // Legado: JSON puro
                    state = JSON.parse(new TextDecoder().decode(uint8));
                }
                this.restoreState(app, state);
                app.updateSeasonSelects();
                if (app.seasonHistory.length > 0) {
                    document.getElementById("viewSeason").value = app.seasonHistory.length;
                    app.viewSeason(app.seasonHistory.length);
                }
                if (app.seasonInProgress && app.seasonState) {
                    if (!app.currentSeasonPreview) {
                        app.currentSeasonPreview = app.buildCurrentSeasonPreview();
                    }
                    app.updateWeekUI();
                    app.updateSeasonSelectsWithPreview();
                    if (app.currentSeasonPreview && app.currentSeasonPreview.competitions.length > 0) {
                        const seasonSelector = document.getElementById("viewSeason");
                        if (seasonSelector) {
                            seasonSelector.value = 'current';
                            app.viewSeason('current');
                        }
                    }
                }
                const progress = document.getElementById('seasonProgress');
                if (progress) { progress.innerHTML = `<span style="color:#4ade80;">✅ Save "${save.name}" carregado!</span>`; progress.style.display = 'block'; }
            } catch (e) {
                console.error('Erro ao carregar save:', e);
                alert('Erro ao carregar este save.');
            }
        } else {
            const progress = document.getElementById('seasonProgress');
            if (progress) { progress.innerHTML = `<span style="color:#4ade80;">Save "${save.name}" selecionado (vazio).</span>`; progress.style.display = 'block'; }
        }
    },

    async deleteSaveSlot(id) {
        if (!confirm('Excluir este save permanentemente?')) return;
        await this.idbDelete(id);
        if (this._activeSaveSlot === id) this._activeSaveSlot = null;
    },

    async saveToIDB(app) {
        if (!this._activeSaveSlot || this._activeSaveSlot === '__none__') {
            const name = prompt('Nome do save:');
            if (!name || !name.trim()) return;
            this._activeSaveSlot = 'save_' + Date.now();
            const buf = await this.exportSave(app);
            await this.idbPut({ id: this._activeSaveSlot, name: name.trim(), data: new Uint8Array(buf), season: app.currentSeason, updatedAt: Date.now() });
        } else {
            const saves = await this.idbGetAll();
            const existing = saves.find(s => s.id === this._activeSaveSlot);
            const buf = await this.exportSave(app);
            await this.idbPut({ id: this._activeSaveSlot, name: existing ? existing.name : 'Save', data: new Uint8Array(buf), season: app.currentSeason, updatedAt: Date.now() });
        }
        const progress = document.getElementById('seasonProgress');
        if (progress) { progress.innerHTML = `<span style="color:#4ade80;">✅ Salvo com sucesso!</span>`; progress.style.display = 'block'; }
    },

    async downloadSave(app) {
        try {
            const buf = await this.exportSave(app);
            const blob = new Blob([buf], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Save${app.currentSeason}.bin`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error("Erro ao baixar backup:", e);
            alert("Erro ao gerar ficheiro de backup.");
        }
    },

    async uploadSave(app, file) {
        try {
            const button = document.getElementById('loadProgressBtn');
            if (button) button.disabled = true;
            const arrayBuffer = await file.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuffer);
            let state;
            if (uint8[0] === this.SAVE_MAGIC[0] && uint8[1] === this.SAVE_MAGIC[1] &&
                uint8[2] === this.SAVE_MAGIC[2] && uint8[3] === this.SAVE_MAGIC[3]) {
                const imported = await this.importSave(arrayBuffer);
                state = imported.state;
            } else {
                // Legado: gzip puro ou JSON puro
                let jsonString;
                if (uint8[0] === 0x1f && uint8[1] === 0x8b) {
                    const ds = new DecompressionStream('gzip');
                    const writer = ds.writable.getWriter();
                    writer.write(arrayBuffer);
                    writer.close();
                    const decompressedBuffer = await new Response(ds.readable).arrayBuffer();
                    jsonString = new TextDecoder().decode(decompressedBuffer);
                } else {
                    jsonString = new TextDecoder().decode(arrayBuffer);
                }
                state = JSON.parse(jsonString);
            }
            this.restoreState(app, state);
            app.updateSeasonSelects();
            if (app.seasonHistory.length > 0) {
                document.getElementById("viewSeason").value = app.seasonHistory.length;
                app.viewSeason(app.seasonHistory.length);
            }
            if (app.seasonInProgress && app.seasonState) {
                if (!app.currentSeasonPreview) {
                    app.currentSeasonPreview = app.buildCurrentSeasonPreview();
                }
                app.updateWeekUI();
                app.updateSeasonSelectsWithPreview();
                if (app.currentSeasonPreview && app.currentSeasonPreview.competitions.length > 0) {
                    const seasonSelector = document.getElementById("viewSeason");
                    if (seasonSelector) {
                        seasonSelector.value = 'current';
                        app.viewSeason('current');
                    }
                }
            }
            if (this._activeSaveSlot && this._activeSaveSlot !== '__none__') {
                const saves = await this.idbGetAll();
                const existing = saves.find(s => s.id === this._activeSaveSlot);
                const buf = await this.exportSave(app);
                await this.idbPut({ id: this._activeSaveSlot, name: existing ? existing.name : 'Backup importado', data: new Uint8Array(buf), season: app.currentSeason, updatedAt: Date.now() });
            }
            const progress = document.getElementById("seasonProgress");
            if (progress) { progress.innerHTML = `<span style="color:#4ade80;">✅ Backup carregado com sucesso!</span>`; progress.style.display = 'block'; }
        } catch (e) {
            console.error('Erro no Upload:', e);
            alert('Este ficheiro não é um save válido ou está incompatível.');
        } finally {
            const button = document.getElementById('loadProgressBtn');
            if (button) button.disabled = false;
        }
    },

    setupSaveLoadListeners(app) {
        const saveBtn = document.getElementById('saveProgressBtn');
        const downloadBtn = document.getElementById('downloadBackupBtn');
        const loadBtn = document.getElementById('loadProgressBtn');
        const fileInput = document.getElementById('loadFileInput');

        if (saveBtn) saveBtn.addEventListener('click', () => this.saveToIDB(app));
        if (downloadBtn) downloadBtn.addEventListener('click', () => this.downloadSave(app));
        if (loadBtn) loadBtn.addEventListener('click', () => fileInput.click());
        if (fileInput) fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.uploadSave(app, file);
                fileInput.value = '';
            }
        });
    }
};