/* ╔══════════════════════════════════════════════════════════════════╗
   ║  Визуальная новелла (VN) для SillyTavern                          ║
   ║  ──────────────────────────────────────────────────────────────  ║
   ║  Оформляет ответы AI, завёрнутые в <vn>...</vn>, в иммерсивный    ║
   ║  полноэкранный плеер визуальной новеллы.                         ║
   ║                                                                    ║
   ║  Режимы фона: Генерация (sillyimages) · Фоны ST · Тёмный.         ║
   ║  Переходы: кроссфейд + «кино» (Ken Burns). Печать текста,         ║
   ║  автоплей, спрайты Character Expressions, кинорамка, виньетка.    ║
   ║                                                                    ║
   ║  СПРАЙТЫ-КАСТ: несколько персонажей на сцене одновременно         ║
   ║  (твой перс, партнёр, {{user}}…). Картинки грузятся в самой       ║
   ║  расширке (IndexedDB), у каждого набор эмоций. ИИ сам выводит     ║
   ║  их тегом <sprite name="…" pos="…" emotion="…">, можно править    ║
   ║  вручную в плеере.                                                ║
   ║                                                                    ║
   ║  Картинки-кадры НЕ генерирует — их делает sillyimages по тегам    ║
   ║    <img data-iig-instruction='{...}' src="[IMG:GEN]">             ║
   ╚══════════════════════════════════════════════════════════════════╝ */
(function () {
    'use strict';

    const MODULE_NAME = 'silly_vn';
    const PROMPT_KEY = 'silly_vn_guide';            // статичный гайд → кэшируемая позиция (IN_PROMPT, выше истории)
    const PROMPT_KEY_REMINDER = 'silly_vn_reminder'; // короткий реминдер + динамика (инвентарь/цели) → depth=2 у точки генерации
    const INJECT_DEPTH = 2;
    const INJECT_SCAN = false;
    const VN_OPEN_RE = /<vn(?:\s[^>]*)?>/i;
    // универсальное распознавание картинок ЛЮБОГО расширения генерации:
    // <img …>, <image>…</image>, image###…###, [IMG:…]; либо свой regex (настройка imgDetect)
    const DEFAULT_IMG_SRC = "<img\\b[^>]*>|<image\\b[^>]*>(?:[\\s\\S]*?<\\/image>)?|image###[\\s\\S]*?###|\\[IMG:[^\\]]*\\]";
    function imgMarkSource() { const c = (getSettings().imgDetect || '').trim(); return c || DEFAULT_IMG_SRC; }
    function imgMarkRe(flags) { try { return new RegExp(imgMarkSource(), flags); } catch (e) { return new RegExp(DEFAULT_IMG_SRC, flags); } }

    const DEFAULTS = Object.freeze({
        enabled: true,
        hideMarkup: true,
        autoOpen: false,
        maxImages: 5,
        minImages: 2,          // нижняя граница диапазона кадров на ответ (передаётся в промпт вместе с maxImages)
        forceLandscape: true,  // все кадры строго 16:9 (горизонтально, лучше для ПК)
        // РЕЖИССЁР: мини-ИИ САМ читает ответ основного ИИ и детерминированно ставит ровно N кадров
        // (minImages..maxImages) + заполняет статус сцены/панели. Основному ИИ при этом НЕ уходит
        // НИКАКОЙ инструкции про картинки/<vn>/<vn-status> — он просто отыгрывает. Так число кадров
        // («от 2 до 3») гарантированно соблюдается, а не зависит от того, послушался ли основной ИИ.
        autoDirector: true,
        injectPrompt: true,    // инжектить наш VN-промпт (выключи, если используешь свой промпт картинок)
        detectAnyImages: true, // распознавать картинки в ЛЮБОЙ обёртке (<illust>/<image_lite>/<div>), не только <vn>
        extBlocksImages: true, // подхватывать картинки из блоков ExtBlocks (message.extra.extblocks) — как «Process external blocks» у sillyimages
        imageSize: '1K',       // качество кадров (image_size): '1K' | '2K' | '4K'; 2K/4K жёстко прописываются в тег
        imgFormat: 'iig',      // какой тег картинок наш промпт велит ИИ эмитить: 'iig' (sillyimages) | 'image' (<image>) | 'other' (своё расширение)
        imgDetect: '',         // свой regex распознавания картинок (перебивает дефолтный союз)
        extraPromptNotes: '',
        // вид
        fontSize: 18,
        dialogWidth: 0,
        dialogHeight: 0,
        glass: 0.62,
        imageFit: 'cover',     // 'cover' | 'contain'
        // ── цвета плеера (кастомизация всего) ────────────────────────
        accentColor: '#78aaff', // акцент интерфейса: кнопки/прогресс/стрелка/рамки — весь «синий» UI
        textColor: '#f4f4f6',  // основной цвет реплик
        speechColor: '#78aaff',// прямая речь («…»)
        italicColor: '#d7d8de',// курсив (действия/мысли)
        boldColor: '#ffffff',  // жирный (акцент в тексте)
        panelColor: '#141416', // фон окна диалога (с матовостью glass)
        speakerColor: '',      // цвет имени говорящего (пусто = акцент)
        borderColor: '',       // цвет рамки окна (пусто = полупрозрачный белый по умолчанию)
        // ── расширенный вид: геометрия окна / типографика / UI ───────
        dialogPos: 'bottom',   // положение окна диалога: 'bottom' | 'top' | 'center'
        textAlign: 'left',     // выравнивание текста: 'left' | 'center' | 'justify'
        dialogRadius: 22,      // скругление углов окна (px)
        dialogBorder: 1,       // толщина рамки окна (px)
        dialogPad: 20,         // внутренние отступы окна (px)
        dialogShadow: 'md',    // тень окна: 'none' | 'soft' | 'md' | 'strong'
        fontFamily: 'inherit', // семейство шрифта реплик (ключ в FONT_STACKS)
        customFont: '',        // своё имя семейства шрифта (необязательно, добавляется в стек)
        lineHeight: 1.7,       // межстрочный интервал
        letterSpacing: 0.3,    // трекинг (px)
        textWeight: 400,       // насыщенность основного текста
        ctrlSize: 'md',        // размер кнопок панели управления: 'sm' | 'md' | 'lg'
        // ── темы-пресеты (полный кастомайз вида) ─────────────────────
        themePresets: [],      // [{ id, name, vals:{...THEME_KEYS} }] — пользовательские темы
        activeTheme: '',       // id применённой темы (для подсветки), '' = ручная настройка
        hasCustomBg: false,    // загружен свой фон (картинка в IndexedDB, bgMode='custom')
        // режимы / чудеса
        layoutMode: 'cinematic', // макет окна реплик: 'cinematic' (кинолента — без плашки, нижний скрим) | 'card' (классическая плашка). НЕ входит в THEME_KEYS — темы ортогональны макету
        bgMode: 'generated',   // 'generated' | 'st' | 'dim'
        stBgUrl: '',           // CSS url("...") выбранного фона ST
        motion: 'fade',        // 'none' | 'fade' | 'cinematic'(fade+Ken Burns) | 'pan'(авто-промотка арта)
        panSpeed: 32,          // секунд на один проход авто-промотки (меньше = быстрее)
        spritePos: 'off',      // живой Character-Expressions спрайт: 'off'|'left'|'center'|'right'
        typewriter: true,      // печать текста по буквам
        typeSpeed: 26,         // мс/символ
        autoSpeed: 'normal',   // темп автоплея: 'slow'|'normal'|'fast'
        richText: true,        // форматирование реплик: *курсив* / **жирный**
        quoteHighlight: true,  // выделять прямую речь («…»/"…") акцентным цветом
        showSpeaker: false,    // имя говорящего над текстом (ненадёжно — только по активному <sprite>; речь лучше видно по выделению прямой речи)
        letterbox: false,      // кинорамка (чёрные полосы)
        vignette: true,        // виньетка для читаемости
        // ── player-UX ────────────────────────────────────────────────
        tapAdvance: true,      // листать тапом по всему экрану (выкл — только стрелкой/кнопками)
        floatHold: 1,          // множитель времени показа всплывашек (0 = держать до клика)
        moodTint: true,        // мягко перекрашивать --svn-accent под настроение сцены
        parallax: true,        // лёгкий параллакс спрайтов/фона при смене кадра
        // спрайты-каст (несколько персонажей одновременно)
        spriteAuto: true,      // ИИ расставляет спрайты тегами <sprite ...>
        speakerFocus: true,    // подсвечивать говорящего, остальных притемнять
        spriteCast: [],        // [{ id, name, pos, def, expr:{ emo: imageId } }]
        // ── движок модулей ────────────────────────────────────────────
        panels: true,          // показывать слой панелей модулей в плеере
        panelsCollapsed: false,// слой панелей свёрнут (тумблер «глаз» в плеере) — чтобы всё можно было спрятать
        ctrlCollapsed: false,  // панель управления плеера свёрнута в одну кнопку — чтобы экран был чище
        aiSource: 'st',        // источник лёгкого ИИ: 'st' (подключение таверны) | 'endpoint' (свой)
        liteEndpoint: '',      // OpenAI-совместимый base url для отдельного эндпоинта
        liteKey: '',           // ключ для отдельного эндпоинта
        liteModel: 'gpt-4o-mini',
        liteModels: [],        // список моделей, подтянутый кнопкой с эндпоинта (для выпадашки)
        liteCtxTurns: 4,       // сколько последних реплик слать лёгкому ИИ
        bgmPlaylistCount: 5,   // ЦЕЛЕВОЙ размер плейлиста: мини-ИИ копит треки до него по сценам, потом не добирает
        modules: {},           // { moduleId: { enabled, ...cfg } }
        moduleState: {},       // липкое состояние { chatKey: { moduleId: data } }
        seenState: {},         // прочитанные кадры { chatKey: { mesId: maxFrameSeen } }
        lastRead: {},          // место чтения { chatKey: { mesId, frame } } — «продолжить с того же места»
    });

    // ── контекст / настройки ──────────────────────────────────────────
    function getCtx() { return SillyTavern.getContext(); }

    function getSettings() {
        const ctx = getCtx();
        if (!ctx.extensionSettings[MODULE_NAME]) {
            ctx.extensionSettings[MODULE_NAME] = structuredClone(DEFAULTS);
        }
        const s = ctx.extensionSettings[MODULE_NAME];
        for (const k of Object.keys(DEFAULTS)) {
            if (!Object.hasOwn(s, k)) s[k] = structuredClone(DEFAULTS[k]);
        }
        // миграция со старого булева spriteMode → spritePos
        if (Object.hasOwn(s, 'spriteMode')) {
            if (s.spritePos === 'off' && s.spriteMode) s.spritePos = 'center';
            delete s.spriteMode;
        }
        if (!Array.isArray(s.spriteCast)) s.spriteCast = [];
        return s;
    }

    function saveSettings() { try { getCtx().saveSettingsDebounced(); } catch (e) { /* ignore */ } }
    function isSpriteOn() { return getSettings().spritePos !== 'off'; }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  ПОЛНЫЙ КАСТОМАЙЗ ВИДА: шрифты, тени, ключи тем, готовые темы   ║
    // ╚════════════════════════════════════════════════════════════════╝
    // семейства шрифтов реплик (best-effort: чего нет в системе — мягко откатится)
    const FONT_STACKS = {
        inherit: '',
        sans: "'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif",
        serif: "Georgia, 'Times New Roman', 'Noto Serif', serif",
        mono: "'JetBrains Mono', Consolas, 'SF Mono', monospace",
        round: "'Comfortaa', 'Quicksand', 'Segoe UI', system-ui, sans-serif",
        cond: "'Oswald', 'Roboto Condensed', 'Arial Narrow', system-ui, sans-serif",
    };
    // значения тени окна для --svn-shadow
    const SHADOW_VALS = {
        none: 'none',
        soft: '0 6px 24px rgba(0, 0, 0, 0.35)',
        md: '0 12px 48px rgba(0, 0, 0, 0.5)',
        strong: '0 18px 70px rgba(0, 0, 0, 0.7)',
    };
    const CTRL_SIZES = { sm: 30, md: 36, lg: 44 };
    // какие настройки составляют «вид» — снимаются в пресет / переключаются темой
    const THEME_KEYS = [
        'accentColor', 'textColor', 'speechColor', 'italicColor', 'boldColor', 'panelColor', 'speakerColor', 'borderColor',
        'glass', 'fontSize', 'dialogWidth', 'dialogHeight',
        'dialogPos', 'textAlign', 'dialogRadius', 'dialogBorder', 'dialogPad', 'dialogShadow',
        'fontFamily', 'customFont', 'lineHeight', 'letterSpacing', 'textWeight', 'ctrlSize',
        'letterbox', 'vignette', 'imageFit',
    ];
    // встроенные темы из коробки (vals — частичные, недостающее берётся из DEFAULTS)
    const BUILTIN_THEMES = [
        { id: 'night', name: 'Ночь', vals: {} }, // дефолтный тёмно-синий
        {
            id: 'sepia', name: 'Сепия', vals: {
                panelColor: '#efe6d4', textColor: '#3b3329', speechColor: '#8a5a2b', italicColor: '#6b5d49',
                boldColor: '#2a2018', accentColor: '#9c6b3f', speakerColor: '#8a5a2b', borderColor: '#d8c7a8',
                glass: 0.92, fontFamily: 'serif', lineHeight: 1.8, dialogShadow: 'soft', dialogRadius: 14, vignette: false,
            },
        },
        {
            id: 'neon', name: 'Неон', vals: {
                panelColor: '#0a0a12', textColor: '#eafcff', speechColor: '#22e0ff', italicColor: '#9fb6c8',
                boldColor: '#ff3df0', accentColor: '#ff3df0', speakerColor: '#22e0ff', borderColor: '#ff3df0',
                glass: 0.72, fontFamily: 'mono', dialogBorder: 2, dialogShadow: 'strong', dialogRadius: 10,
                letterSpacing: 0.6, textWeight: 500,
            },
        },
        {
            id: 'minimal', name: 'Минимал', vals: {
                panelColor: '#101012', accentColor: '#cfd3da', speechColor: '#ffffff', glass: 0.28,
                dialogBorder: 0, dialogShadow: 'none', dialogRadius: 8, textWeight: 300, fontFamily: 'sans', lineHeight: 1.7,
            },
        },
        {
            id: 'retro', name: 'Ретро-VN', vals: {
                panelColor: '#12141c', accentColor: '#ffcc55', speakerColor: '#ffcc55', speechColor: '#ffe08a',
                textColor: '#f5f1e6', dialogPos: 'bottom', dialogRadius: 18, dialogPad: 24, dialogBorder: 2,
                dialogShadow: 'md', glass: 0.8, fontFamily: 'serif', fontSize: 19, lineHeight: 1.75,
            },
        },
    ];
    // DEFAULTS-срез по THEME_KEYS — база, поверх которой кладётся тема
    function themeDefaults() { const o = {}; for (const k of THEME_KEYS) o[k] = structuredClone(DEFAULTS[k]); return o; }
    // итоговый стек шрифта реплик/карточек: своё семейство + выбранный набор (или inherit)
    function fontStackOf(s) {
        const fam = [s.customFont && s.customFont.trim(), FONT_STACKS[s.fontFamily] || ''].filter(Boolean).join(', ');
        return fam || 'inherit';
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  БИБЛИОТЕКА СПРАЙТОВ                                            ║
    // ║  метаданные каста — в настройках, картинки — в IndexedDB        ║
    // ╚════════════════════════════════════════════════════════════════╝
    const IDB_NAME = 'sillyvn', IDB_STORE = 'sprites';
    let _idb = null;
    const spriteCache = new Map();   // imageId -> dataURL

    function openIdb() {
        if (_idb) return _idb;
        _idb = new Promise((resolve, reject) => {
            let req;
            try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { reject(e); return; }
            req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return _idb;
    }
    async function idbPut(id, dataUrl) {
        const db = await openIdb();
        return new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(dataUrl, id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    }
    async function idbGet(id) {
        const db = await openIdb();
        return new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, 'readonly'); const r = tx.objectStore(IDB_STORE).get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
    }
    async function idbDel(id) {
        try { const db = await openIdb(); await new Promise((res) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).delete(id); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ }
    }
    async function loadSpriteCache() {
        const ids = new Set();
        for (const a of getCast()) for (const k in (a.expr || {})) if (a.expr[k]) ids.add(a.expr[k]);
        await Promise.all([...ids].map(async id => {
            if (!spriteCache.has(id)) { try { const d = await idbGet(id); if (d) spriteCache.set(id, d); } catch (e) { /* ignore */ } }
        }));
    }
    function newId() { return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

    // ── свой фон сцены (bgMode='custom') — картинка живёт в IndexedDB ──
    const CUSTOM_BG_KEY = '__svn_custom_bg';
    let _customBgUrl = null; // кэш dataURL
    async function loadCustomBg() {
        try { _customBgUrl = (await idbGet(CUSTOM_BG_KEY)) || null; } catch (e) { _customBgUrl = null; }
        return _customBgUrl;
    }
    async function setCustomBgFromFile(file) {
        const data = await processImageFile(file, 1920);
        await idbPut(CUSTOM_BG_KEY, data);
        _customBgUrl = data;
        const s = getSettings(); s.hasCustomBg = true; saveSettings();
        return data;
    }
    async function clearCustomBg() {
        await idbDel(CUSTOM_BG_KEY); _customBgUrl = null;
        const s = getSettings(); s.hasCustomBg = false; saveSettings();
    }
    function customBgUrl() { return _customBgUrl; }

    // загрузка картинки из файла → dataURL (с уменьшением, webp); maxPx — макс. сторона (фон крупнее спрайтов)
    function processImageFile(file, maxPx) {
        return new Promise((resolve, reject) => {
            if (!file || !/^image\//.test(file.type)) { reject(new Error('not an image')); return; }
            const fr = new FileReader();
            fr.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const MAX = maxPx || 1024;
                    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
                    const scale = Math.min(1, MAX / Math.max(w, h || 1));
                    if (scale < 1) { w = Math.round(w * scale); h = Math.round(h * scale); }
                    try {
                        const c = document.createElement('canvas'); c.width = w; c.height = h;
                        c.getContext('2d').drawImage(img, 0, 0, w, h);
                        resolve(c.toDataURL('image/webp', 0.92));
                    } catch (e) { resolve(fr.result); }
                };
                img.onerror = () => resolve(fr.result);
                img.src = fr.result;
            };
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(file);
        });
    }

    // ── актёры ────────────────────────────────────────────────────────
    const EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'scared', 'shy', 'smug', 'thinking', 'cry', 'love', 'serious'];
    function getCast() { const s = getSettings(); if (!Array.isArray(s.spriteCast)) s.spriteCast = []; return s.spriteCast; }
    function actorKey(name) {
        const n = String(name || '').trim();
        if (!n) return '';
        if (/\{\{\s*user\s*\}\}/i.test(n)) return '__user__';
        if (/\{\{\s*char\s*\}\}/i.test(n)) return '__char__';
        const ctx = getCtx();
        const persona = String(ctx.name1 || '').trim().toLowerCase();
        if (persona && n.toLowerCase() === persona) return '__user__';
        const charName = String(ctx.name2 || '').trim().toLowerCase();
        if (charName && n.toLowerCase() === charName) return '__char__';
        return n.toLowerCase();
    }
    // ключ актёра по его роли (char/user → стабильный, иначе по имени)
    function actorKeyOf(a) {
        if (!a) return '';
        if (a.role === 'user') return '__user__';
        if (a.role === 'char') return '__char__';
        return actorKey(a.name);
    }
    // отображаемое имя: char → имя персонажа таверны, user → {{user}}
    function displayActorName(a) {
        if (!a) return '';
        if (a.role === 'user') return '{{user}}';
        if (a.role === 'char') { const cn = String(getCtx().name2 || '').trim(); return cn || (a.name || '{{char}}'); }
        return a.name || 'NPC';
    }
    function findActor(name) {
        const key = actorKey(name);
        if (!key) return null;
        for (const a of getCast()) if (actorKeyOf(a) === key) return a;
        return null;
    }
    function findActorByKey(key) { for (const a of getCast()) if (actorKeyOf(a) === key) return a; return null; }
    function actorEmotions(a) { return a && a.expr ? Object.keys(a.expr).filter(k => a.expr[k]) : []; }
    function resolveActorEmotion(a, emo) {
        const ex = (a && a.expr) || {};
        if (emo && ex[emo]) return emo;
        if (a && a.def && ex[a.def]) return a.def;
        const ks = Object.keys(ex).filter(k => ex[k]);
        return ks.length ? ks[0] : null;
    }
    function actorSpriteUrl(a, emo) {
        const e = resolveActorEmotion(a, emo);
        if (!e) return null;
        const id = a.expr[e];
        return id ? (spriteCache.get(id) || null) : null;
    }
    function castRosterText() {
        const list = getCast().filter(a => actorEmotions(a).length);
        if (!list.length) return '';
        return list.map(a => {
            const emos = actorEmotions(a).join(', ');
            const pos = a.pos && a.pos !== 'off' ? a.pos : 'center';
            const rl = a.role === 'char' ? ' [главный герой]' : a.role === 'user' ? ' [игрок]' : ' [NPC]';
            return `   • ${displayActorName(a)}${rl} — позиция по умолчанию ${pos}; эмоции: ${emos}`;
        }).join('\n');
    }

    // режиссёр активен: мини-ИИ сам ставит кадры (форматы, теги которых мы умеем собирать — iig/<image>)
    function directorActive() {
        const s = getSettings();
        const fmt = s.imgFormat || 'iig';
        return s.enabled && s.autoDirector !== false && (fmt === 'iig' || fmt === 'image');
    }
    // СЛИМ-гайд для режима режиссёра: основному ИИ — НИКАКИХ инструкций про картинки/формат/<vn>/<vn-status>
    // (это всё делает мини-ИИ-режиссёр после ответа). Оставляем только авторские указания и статичные
    // заметки модулей, которые касаются СЮЖЕТА (например, выборы <choices>), а не оформления.
    function buildDirectorGuide() {
        const s = getSettings();
        const parts = [];
        if (s.extraPromptNotes && s.extraPromptNotes.trim()) parts.push(`[Дополнительные указания автора]\n${s.extraPromptNotes.trim()}`);
        const modNotes = (typeof modulePromptNotes === 'function') ? modulePromptNotes(false) : '';
        if (modNotes) parts.push(modNotes);
        return parts.join('\n\n');
    }

    // ── системный промпт (на русском) ─────────────────────────────────
    function buildGuide() {
        const s = getSettings();
        if (directorActive()) return buildDirectorGuide();
        const maxImg = Math.max(1, Math.min(10, parseInt(s.maxImages, 10) || 5));
        const minImg = Math.max(1, Math.min(maxImg, parseInt(s.minImages, 10) || 1));
        const countClause = (minImg >= maxImg)
            ? `Ставь ровно ${maxImg} ${plural(maxImg, 'картинку-кадр', 'картинки-кадра', 'картинок-кадров')} на ответ.`
            : `Ставь от ${minImg} до ${maxImg} картинок-кадров на ответ — обязательно НЕ меньше ${minImg} и не больше ${maxImg}.`;
        const fmt = s.imgFormat || 'iig';
        const land = s.forceLandscape !== false;
        const imgSize = s.imageSize || '1K';
        // ── инструкция по картинкам зависит от выбранного расширения генерации ──
        let imgRules, example;
        if (fmt === 'image') {
            imgRules =
`2) Прямо внутри <vn> расставляй картинки-кадры тегом твоего генератора изображений:
<image>детальный промпт сцены на АНГЛИЙСКОМ</image>
— Один тег <image>…</image> = один кадр. Ставь его ПЕРЕД текстом, к которому он относится; первой картинкой — общий план сцены.

3) Внутри <image> пиши на АНГЛИЙСКОМ, подробно (80–150 слов): кто в кадре, поза, эмоция, ракурс, свет, окружение, атмосфера. Внешность и стиль КАЖДОГО героя держи КОНСИСТЕНТНЫМИ от кадра к кадру.`;
            example =
`<vn>
<image>wide cinematic establishing shot of a rain-soaked neon alley at night, cold moody lighting, soft anime illustration</image>
Дождь хлестал по витринам. Лина остановилась под козырьком.
<image>close-up portrait of Lina, 22yo, wet auburn hair, green eyes, black trench coat, tense expression, soft anime illustration</image>
«Ты всё-таки пришёл», — тихо сказала она.
</vn>`;
        } else if (fmt === 'other') {
            imgRules =
`2) Картинки-кадры вставляй средствами СВОЕГО расширения генерации изображений — ровно в том формате тега, который оно ожидает (если оно само не подсказывает формат — задай его в «Доп. указаниях» в настройках). Ставь картинку ПЕРЕД текстом, к которому она относится; первой — общий план сцены.

3) Описывай каждый кадр подробно; внешность и стиль КАЖДОГО героя держи КОНСИСТЕНТНЫМИ от кадра к кадру.`;
            example =
`<vn>
[тег картинки твоего расширения: общий план сцены]
Дождь хлестал по витринам. Лина остановилась под козырьком.
[тег картинки твоего расширения: крупный план Лины]
«Ты всё-таки пришёл», — тихо сказала она.
</vn>`;
        } else { // iig — sillyimages
            imgRules =
`2) Прямо внутри <vn> расставляй картинки-кадры. Формат тега КАЖДОЙ картинки строго такой:
<img data-iig-instruction='{"prompt":"...","aspect_ratio":"16:9","image_size":"${imgSize}"}' src="[IMG:GEN]">
— КРИТИЧНО: значение data-iig-instruction в ОДИНАРНЫХ кавычках, а JSON внутри — в ДВОЙНЫХ. Никогда не наоборот.
${land ? '— aspect_ratio ВСЕГДА "16:9" (горизонтальный кадр).\n' : ''}— src новой картинки ВСЕГДА ровно [IMG:GEN]. Запрещено вставлять внешние ссылки/пути (pollinations, imgur, /user/images) или копировать пути из истории — каждая новая картинка только [IMG:GEN].

3) Поле "prompt" пиши на АНГЛИЙСКОМ, подробно (80–150 слов): что в кадре, кто, поза и эмоция, ракурс, свет, окружение, атмосфера.
— У КАЖДОГО персонажа свой постоянный облик и стиль рисовки; держи внешность КОНСИСТЕНТНОЙ от кадра к кадру и от ответа к ответу.
— Стиль задаёшь сам в промпте ('soft anime illustration', 'gritty cinematic realism', 'watercolor' и т.п.) и далее придерживаешься его.`;
            example =
`<vn>
<img data-iig-instruction='{"prompt":"wide cinematic establishing shot of a rain-soaked neon alley at night, puddles reflecting pink and blue signs, cold moody lighting, soft anime illustration","aspect_ratio":"16:9","image_size":"${imgSize}"}' src="[IMG:GEN]">
Дождь хлестал по витринам. Лина остановилась под козырьком, не решаясь шагнуть дальше.
<img data-iig-instruction='{"prompt":"close-up portrait of Lina, 22yo woman, wet auburn shoulder-length hair, sharp green eyes, black trench coat, tense expression, soft anime illustration, rain bokeh background","aspect_ratio":"16:9","image_size":"${imgSize}"}' src="[IMG:GEN]">
«Ты всё-таки пришёл», — тихо сказала она, не оборачиваясь.
</vn>`;
        }
        const comp = (fmt === 'other')
            ? `4) Между абзацами добавляй новые кадры на смену момента (крупный план, реакция героя, новая локация). ${countClause} Текст между двумя картинками показывается ПОВЕРХ предыдущей — ставь картинку ПЕРЕД её текстом.`
            : (land
                ? `4) Композиция: ВСЕ картинки строго ГОРИЗОНТАЛЬНЫЕ (16:9, кадр раскрывается на весь экран). Первой — общий план-фон сцены, дальше между абзацами новые кадры на смену момента. ${countClause} Текст между двумя картинками показывается ПОВЕРХ предыдущей — ставь картинку ПЕРЕД её текстом.`
                : `4) Композиция: первой картинкой — общий план-фон сцены, дальше можно портреты/крупные планы. ${countClause} Текст между двумя картинками показывается ПОВЕРХ предыдущей — ставь картинку ПЕРЕД её текстом.`);
        let g =
`[Режим: Визуальная новелла]
Ты — рассказчик визуальной новеллы. Оформляй КАЖДЫЙ свой ответ-отыгрыш строго так:

1) Весь ответ заверни в один блок: <vn> ... </vn>. Внутри пиши живое повествование и реплики на русском языке.

${imgRules}

${comp}

5) Не используй markdown-блоки кода (тройные апострофы), <script> и onclick. Только текст и теги картинок внутри <vn>.

ОБРАЗЕЦ структуры (картинка, затем её текст, при смене момента — новая картинка):
${example}`;
        if (s.spriteAuto !== false) {
            const roster = castRosterText();
            if (roster) {
                g +=
`

6) Спрайты персонажей на сцене. Прямо внутри <vn> управляй тем, кто в кадре и с какой эмоцией, отдельным тегом:
<sprite name="ИМЯ" pos="left|center|right" emotion="ЭМОЦИЯ">
— Ставь этот тег ПЕРЕД репликой или действием персонажа: так его спрайт появится (или сменит эмоцию/позу) к нужному моменту. Тег спрайта — отдельная строка, он сам по себе ничего не пишет в тексте.
— Чтобы убрать персонажа со сцены: <sprite name="ИМЯ" pos="off">.
— Когда говорит конкретный персонаж — обнови его <sprite> прямо перед его словами (его спрайт подсветится как говорящий).
— Используй ТОЛЬКО перечисленных ниже персонажей и ТОЛЬКО их доступные эмоции; имена пиши в точности как в списке ({{user}} — это игрок):
${roster}
— Спрайты НЕ заменяют картинки-кадры: продолжай ставить и кадры, и спрайты <sprite>.`;
            }
        }
        if (s.extraPromptNotes && s.extraPromptNotes.trim()) {
            g += `\n\n[Дополнительные указания автора]\n${s.extraPromptNotes.trim()}`;
        }
        const statusNote = (typeof buildStatusNote === 'function') ? buildStatusNote() : '';
        if (statusNote) g += `\n\n${statusNote}`;
        const modNotes = (typeof modulePromptNotes === 'function') ? modulePromptNotes(false) : ''; // только СТАТИЧНЫЕ заметки (напр. выборы)
        if (modNotes) g += `\n\n${modNotes}`;
        return g;
    }
    // короткий реминдер формата + ДИНАМИЧНЫЕ заметки модулей (инвентарь/цели) — идёт на depth=2 у точки генерации
    function buildReminder() {
        // режим режиссёра: основному ИИ не напоминаем про формат <vn>/статус — он просто отыгрывает.
        // Оставляем только динамичный СЮЖЕТНЫЙ контекст модулей (инвентарь/цели — чтобы персонаж их помнил).
        if (directorActive()) return (typeof modulePromptNotes === 'function') ? modulePromptNotes(true) : '';
        const hasStatus = MODULES.some(m => moduleEnabled(m.id) && typeof m.statusFields === 'function'
            && (() => { try { const f = m.statusFields(m._api); return Array.isArray(f) && f.length; } catch (e) { return false; } })());
        let r = `[Формат VN] Весь ответ-отыгрыш — внутри одного блока <vn>…</vn> с картинками-кадрами (формат тега и правила — в системной части выше)`;
        r += hasStatus ? `; в САМОМ конце, внутри <vn>, добавь служебный <vn-status> по описанному выше формату.` : `.`;
        const dyn = (typeof modulePromptNotes === 'function') ? modulePromptNotes(true) : ''; // инвентарь/цели — текущее состояние
        return dyn ? r + `\n\n${dyn}` : r;
    }

    function updateInjection() {
        const ctx = getCtx();
        if (typeof ctx.setExtensionPrompt !== 'function') return;
        const s = getSettings();
        const on = s.enabled && s.injectPrompt !== false;
        const types = ctx.extension_prompt_types || {};
        const roles = ctx.extension_prompt_roles || {};
        const role = (typeof roles.SYSTEM === 'number') ? roles.SYSTEM : 0;
        const inChat = (typeof types.IN_CHAT === 'number') ? types.IN_CHAT : 1;
        const inPrompt = (typeof types.IN_PROMPT === 'number') ? types.IN_PROMPT : 0;
        const set = (key, text, pos, depth) => {
            try { ctx.setExtensionPrompt(key, text, pos, depth, INJECT_SCAN, role); }
            catch (e) { try { ctx.setExtensionPrompt(key, text, pos, depth); } catch (_) { /* ignore */ } }
        };
        // 1) СТАТИЧНЫЙ гайд (ядро + пример + ростер + формат <vn-status>) — в кэшируемую позицию IN_PROMPT
        //    (выше истории чата): меняется только при правке настроек/каста/модулей, иначе бьётся по кэшу провайдера
        //    и НЕ пере-биллится каждый запрос. depth для IN_PROMPT не важен.
        set(PROMPT_KEY, on ? buildGuide() : '', inPrompt, 0);
        // 2) Короткий реминдер формата + ДИНАМИКА (инвентарь/цели — меняются по ходу игры) — на depth=2
        //    у точки генерации: дёшево по токенам и фиксит дрифт формата.
        set(PROMPT_KEY_REMINDER, on ? buildReminder() : '', inChat, INJECT_DEPTH);
    }

    // ── вспомогалки ───────────────────────────────────────────────────
    function decodeEntities(str) {
        if (!str || str.indexOf('&') === -1) return str || '';
        const ta = document.createElement('textarea'); ta.innerHTML = str; return ta.value;
    }
    function cssUrl(u) { return String(u || '').replace(/["\\]/g, '\\$&'); }
    function isCssUrlString(u) { return /^\s*url\(/i.test(String(u || '')); }
    function bgImageValue(u) {
        if (!u) return '';
        return isCssUrlString(u) ? u : `url("${cssUrl(u)}")`;
    }
    function plural(n, one, few, many) {
        const m10 = n % 10, m100 = n % 100;
        if (m10 === 1 && m100 !== 11) return one;
        if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
        return many;
    }
    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // служебные блоки статуса — НЕ показываем в прозе:
    //  • <vn-status>…</vn-status> — наш компактный статус (сцена/отношения), его пишет основной ИИ;
    //  • <datetime>…</datetime>   — блок внешнего расширения-календаря (дата/время/погода).
    function stripMeta(t) {
        return String(t || '')
            .replace(/<vn-status\b[\s\S]*?<\/vn-status>/gi, '')
            .replace(/<vn-status\b[\s\S]*$/i, '')   // незакрытый (ответ обрезан на статусе) — режем до конца, чтобы поля не текли в прозу
            .replace(/<datetime\b[\s\S]*?<\/datetime>/gi, '')
            .replace(/<datetime\b[\s\S]*$/i, '');
    }
    // парс <vn-status> (поля key: value построчно) + <datetime> календаря.
    // symp/trust/attr — ДЕЛЬТЫ за последний обмен репликами (-10..10), как раньше отдавал лёгкий ИИ.
    function parseVnStatus(raw) {
        const out = { place: '', mood: '', time: '', weather: '', date: '', reason: '', trait: '', music: '',
                      emotion: '', item: '', goal: '', flag: '',
                      symp: null, trust: null, attr: null, hasStatus: false, hasDatetime: false };
        if (!raw) return out;
        const lineGet = (body, k) => {
            const m = body.match(new RegExp('(?:^|\\n)\\s*' + k + '\\s*[:=]\\s*([^\\n]*)', 'i'));
            return m ? m[1].trim() : '';
        };
        const sm = raw.match(/<vn-status\b[^>]*>([\s\S]*?)<\/vn-status>/i);
        if (sm) {
            out.hasStatus = true;
            const body = decodeEntities(sm[1]);
            out.place = lineGet(body, 'place') || lineGet(body, 'место');
            out.mood = lineGet(body, 'mood') || lineGet(body, 'настроение');
            out.time = lineGet(body, 'time') || lineGet(body, 'время');
            out.weather = lineGet(body, 'weather') || lineGet(body, 'погода');
            const num = (k) => { const v = lineGet(body, k); if (v === '') return null; const n = parseInt(v.replace(/[^\-\d]/g, ''), 10); return isNaN(n) ? null : Math.max(-10, Math.min(10, n)); };
            out.symp = num('symp'); out.trust = num('trust'); out.attr = num('attr');
            out.reason = (lineGet(body, 'reason') || '').replace(/^["«»\s]+|["«»\s]+$/g, '').slice(0, 120);
            out.trait = (lineGet(body, 'trait') || '').toLowerCase().replace(/[.!,;]+$/, '').slice(0, 24);
            out.music = (lineGet(body, 'music') || lineGet(body, 'музыка') || '').replace(/^["«»\s]+|["«»\s]+$/g, '').slice(0, 80);
            out.emotion = (lineGet(body, 'emotion') || lineGet(body, 'эмоция') || '').toLowerCase().replace(/[^0-9a-zа-яё _-]/gi, '').trim().slice(0, 20);
            out.item = (lineGet(body, 'item') || lineGet(body, 'предмет') || lineGet(body, 'предметы') || '').slice(0, 160);
            out.goal = (lineGet(body, 'goal') || lineGet(body, 'цель') || lineGet(body, 'цели') || '').slice(0, 200);
            out.flag = (lineGet(body, 'flag') || lineGet(body, 'флаг') || lineGet(body, 'событие') || '').slice(0, 200);
        }
        // внешний календарь перебивает время/погоду/дату (у пользователя они точные)
        const dm = raw.match(/<datetime\b[^>]*>([\s\S]*?)<\/datetime>/i);
        if (dm) {
            out.hasDatetime = true;
            const body = decodeEntities(dm[1]);
            const dt = lineGet(body, 'time'), dd = lineGet(body, 'date'), dw = lineGet(body, 'weather');
            if (dt) out.time = dt;
            if (dw) out.weather = dw;
            if (dd) out.date = dd;
        }
        return out;
    }

    // ── парсинг сцены ─────────────────────────────────────────────────
    function extractVnBlock(raw) {
        if (!raw) return null;
        const open = raw.match(VN_OPEN_RE);
        if (!open) return null;
        const start = open.index + open[0].length;
        const closeIdx = raw.toLowerCase().indexOf('</vn>', start);
        return closeIdx === -1 ? raw.slice(start) : raw.slice(start, closeIdx);
    }
    function hasImageTags(raw) {
        return imgMarkRe('i').test(raw);
    }
    // источник сцены: <vn>…</vn> ИЛИ (если разрешено) весь ответ с картинками в любой обёртке (<illust>/<image_lite>/<div>…)
    function sceneSource(raw) {
        if (!raw) return null;
        if (VN_OPEN_RE.test(raw)) return extractVnBlock(raw);
        if (getSettings().detectAnyImages !== false && hasImageTags(raw)) return raw;
        return null;
    }
    // ── ExtBlocks: картинки из «внешних блоков» (message.extra.extblocks) ──
    // ExtBlocks держит сгенерённые блоки в extra.extblocks (НЕ в .mes!), а sillyimages с опцией
    // «Process external blocks» вписывает туда реальный src после генерации (см. их parser.js:
    // parseMessageImageTags/replaceTagInMessageSource). Достаём оттуда теги-картинки и подмешиваем
    // в источник сцены — тогда VN видит блок-картинки как обычные кадры.
    function blockImageTags(msg) {
        if (getSettings().extBlocksImages === false) return '';
        const eb = msg && msg.extra && msg.extra.extblocks;
        if (!eb) return '';
        const tags = eb.match(imgMarkRe('gi'));
        return tags && tags.length ? tags.join('\n') : '';
    }
    // полный текст-источник сообщения для VN = .mes + теги-картинки из блоков ExtBlocks.
    // Теги вставляем ВНУТРЬ <vn> (перед </vn>), иначе extractVnBlock их отрежет; без <vn> — дописываем в конец.
    function msgSource(msg) {
        const mes = (msg && msg.mes) || '';
        const eb = blockImageTags(msg);
        if (!eb) return mes.indexOf(IMG_PLACEHOLDER) !== -1 ? mes.replace(/<!--svn-img-->/gi, '') : mes;
        const tags = eb.match(imgMarkRe('gi')) || [];
        if (!tags.length) return mes.indexOf(IMG_PLACEHOLDER) !== -1 ? mes.replace(/<!--svn-img-->/gi, '') : mes;
        // 1) плейсхолдеры в .mes сохранились — подставляем блок-картинки на их места (точный interleave с текстом)
        if (mes.indexOf(IMG_PLACEHOLDER) !== -1) {
            let i = 0;
            let out = mes.replace(/<!--svn-img-->/gi, () => (i < tags.length ? tags[i++] : ''));
            if (i < tags.length) { // блок-картинок больше, чем плейсхолдеров — остаток перед </vn>
                const rest = tags.slice(i).join('\n');
                const ci2 = out.toLowerCase().indexOf('</vn>');
                out = ci2 !== -1 ? out.slice(0, ci2) + '\n' + rest + '\n' + out.slice(ci2) : out + '\n' + rest;
            }
            return out;
        }
        // 2) плейсхолдеров НЕТ (SillyTavern вырезает HTML-комменты из .mes при сохранении/рендере) —
        //    РАВНОМЕРНО распределяем блок-картинки по прозе <vn>, как их ставил режиссёр. Без этого
        //    все картинки сваливались в конец, кадры схлопывались на imageIndex 0 → фон НЕ переключался.
        const open = mes.match(VN_OPEN_RE);
        if (open) {
            const headEnd = open.index + open[0].length;
            const ciL = mes.toLowerCase().indexOf('</vn>', headEnd);
            const close = ciL === -1 ? mes.length : ciL;
            let body = mes.slice(headEnd, close), tail = '';
            const cm = body.match(/<choices\b[^>]*>[\s\S]*$/i); // выборы держим в конце — картинки в них не суём
            if (cm) { tail = body.slice(cm.index); body = body.slice(0, cm.index); }
            return mes.slice(0, headEnd) + injectInserts(body, tags) + tail + mes.slice(close);
        }
        return injectInserts(mes, tags); // нет <vn> — распределяем по всему тексту
    }
    function parseImgTag(tag) {
        const out = { prompt: '', aspect: '', style: '', raw: tag };
        const mm = tag.match(/data-iig-instruction\s*=\s*(['"])([\s\S]*?)\1/i);
        if (mm) {
            const json = decodeEntities(mm[2]);
            try { const o = JSON.parse(json); out.prompt = o.prompt || ''; out.aspect = o.aspect_ratio || ''; out.style = o.style || ''; }
            catch (e) {
                const pm = json.match(/"prompt"\s*:\s*"([\s\S]*?)"\s*[,}]/); if (pm) out.prompt = pm[1];
                const am = json.match(/"aspect_ratio"\s*:\s*"([^"]*)"/); if (am) out.aspect = am[1];
            }
        }
        return out;
    }
    function parseSpriteTag(tag) {
        const attr = (n) => {
            const mm = tag.match(new RegExp(n + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1", 'i'));
            return mm ? decodeEntities(mm[2]).trim() : '';
        };
        const emo = (attr('emotion') || attr('emo') || attr('expression') || '').toLowerCase();
        return { name: attr('name'), pos: (attr('pos') || attr('position') || '').toLowerCase(), emo };
    }
    function cleanText(t) {
        if (!t) return '';
        t = stripMeta(t);
        t = t.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, ''); // маркеры markdown-блоков кода (модель иногда оборачивает ими прозу вопреки запрету)
        t = t.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6])>/gi, '\n');
        t = t.replace(/<imgthink[\s\S]*?<\/imgthink>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '');
        t = decodeEntities(t);
        // разделители/тире: модель иногда сыплет «---» как разрыв или вместо тире
        t = t.replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '');   // строка-разделитель (--- *** ___) → убрать
        t = t.replace(/[ \t]*-{2,}[ \t]*/g, ' — ');       // инлайновые -- / --- → длинное тире
        return t.replace(/[ \t]{2,}/g, ' ');
    }
    // разбивка на «реплики»-кадры по концам предложений, НО речь «…»/"…" НЕ дробим
    // (иначе кавычка-закрытие уезжает в другой кадр → подсветка речи «течёт», и читается рвано).
    function splitSentences(text) {
        const raw = [];
        for (const line of String(text).split(/\n+/)) {
            const t = line.trim(); if (!t) continue;
            let buf = '', depth = 0, dq = false;
            const push = () => { const v = buf.trim(); if (v) raw.push(v); buf = ''; };
            for (let i = 0; i < t.length; i++) {
                const ch = t[i]; buf += ch;
                if (ch === '«' || ch === '“' || ch === '„') depth++;
                else if (ch === '»' || ch === '”') { if (depth > 0) depth--; }
                else if (ch === '"') dq = !dq;
                else if ((ch === '.' || ch === '!' || ch === '?' || ch === '…') && depth === 0 && !dq) {
                    while (i + 1 < t.length && '.!?…'.includes(t[i + 1])) buf += t[++i];               // склеить «?!», «…»
                    while (i + 1 < t.length && '"»”\')]'.includes(t[i + 1])) { const c = t[++i]; buf += c; if (c === '"') dq = false; } // и закрывающие кавычки/скобки
                    push();
                }
            }
            push();
        }
        const out = [];
        for (const p of raw) {
            if (out.length && out[out.length - 1].length < 40) out[out.length - 1] = (out[out.length - 1] + ' ' + p).trim();
            else out.push(p);
        }
        return out;
    }
    function parseScene(raw) {
        let inner = sceneSource(raw);
        if (inner == null) return null;
        inner = stripMeta(inner); // <vn-status>/<datetime> — служебные блоки, не показываем как прозу
        inner = inner.replace(/<choices\b[^>]*>[\s\S]*?<\/choices>/gi, ''); // блок выборов — отдельный модуль, не показываем как прозу
        inner = inner.replace(/<choices\b[^>]*>[\s\S]*$/i, ''); // незакрытый блок выборов (ответ обрезан) — тоже режем до конца
        const totalImgs = (inner.match(imgMarkRe('gi')) || []).length;
        const tokenRe = new RegExp(imgMarkSource() + '|<sprite\\b[^>]*>', 'gi');
        const slots = [], frames = [];
        let stage = {}, active = null, imgSeen = 0, lastIdx = 0, m;
        const cloneStage = () => { const o = {}; for (const k in stage) o[k] = { name: stage[k].name, pos: stage[k].pos, emo: stage[k].emo }; return o; };
        const emitText = (chunk) => {
            const imageIndex = totalImgs === 0 ? -1 : Math.max(0, imgSeen - 1);
            for (const sen of splitSentences(cleanText(chunk)))
                frames.push({ text: sen, imageIndex, cast: cloneStage(), active });
        };
        while ((m = tokenRe.exec(inner)) !== null) {
            emitText(inner.slice(lastIdx, m.index));
            lastIdx = m.index + m[0].length;
            const tag = m[0];
            if (!/^<sprite/i.test(tag)) { slots.push(parseImgTag(tag)); imgSeen++; }
            else {
                const d = parseSpriteTag(tag);
                const key = actorKey(d.name);
                if (!key) continue;
                if (d.pos === 'off' || d.pos === 'exit' || d.emo === 'exit' || d.emo === 'off') {
                    delete stage[key]; if (active === key) active = null;
                } else {
                    const prev = stage[key] || {};
                    stage[key] = { name: d.name, pos: d.pos || prev.pos || '', emo: d.emo || prev.emo || '' };
                    active = key;
                }
            }
        }
        emitText(inner.slice(lastIdx));
        if (frames.length === 0 && slots.length > 0) for (let i = 0; i < slots.length; i++) frames.push({ text: '', imageIndex: i, cast: {}, active: null });
        if (frames.length === 0) frames.push({ text: '', imageIndex: slots.length ? 0 : -1, cast: cloneStage(), active });
        return { frames, slots };
    }
    // мемоизация parseScene по сообщению: на длинных чатах галерея/бэклог/карточки парсили КАЖДУЮ
    // сцену заново при каждом открытии. Кэш по сигнатуре (длина источника + индекс свайпа) —
    // правка/свайп/догрузка пути картинки меняют длину → запись сама инвалидируется. Чистится на смене чата.
    // Возвращает тот же объект сцены — потребители читают его только на чтение (плеер берёт свежий parseScene).
    const _sceneCache = new Map(); // id -> { sig, scene }
    function parseSceneCached(id) {
        const msg = (getCtx().chat || [])[id]; if (!msg) return null;
        const src = msgSource(msg);
        const sig = src.length + ':' + (msg.swipe_id || 0);
        const hit = _sceneCache.get(id);
        if (hit && hit.sig === sig) return hit.scene;
        const scene = parseScene(src);
        _sceneCache.set(id, { sig, scene });
        return scene;
    }

    // ── URL картинок-кадров из DOM (как подставил sillyimages) ─────────
    function getMesEl(id) { return document.querySelector(`#chat .mes[mesid="${id}"]`); }
    function normalizeSrc(src) {
        if (!src) return null;
        if (src.includes('[IMG:') || src.includes('[VID:') || src.includes('error.svg')) return null;
        return src;
    }
    function resolveImageUrls(id, slotCount) {
        const res = new Array(slotCount).fill(null);
        if (!(slotCount > 0)) return res;
        // 1) РЕАЛЬНЫЙ путь прямо из текста сообщения: sillyimages после генерации вписывает
        //    src="/user/images/…" в сам тег. Это надёжнее DOM — работает даже когда проза скрыта
        //    (.svn-active → mes_text display:none) или картинка лениво не догрузилась.
        const msg = (getCtx().chat || [])[id];
        const raw = msgSource(msg);
        if (raw) {
            const src = sceneSource(raw);
            const inner = (src != null ? src : raw).replace(/<choices\b[^>]*>[\s\S]*?<\/choices>/gi, '');
            const tags = inner.match(imgMarkRe('gi')) || [];
            for (let i = 0; i < slotCount && i < tags.length; i++) {
                const sm = tags[i].match(/\bsrc\s*=\s*(['"])([\s\S]*?)\1/i);
                if (sm) { const n = normalizeSrc(decodeEntities(sm[2]).trim()); if (n) res[i] = n; }
            }
        }
        // 2) добор из DOM — для расширений, что НЕ вписывают путь в текст (<image>…</image> и пр.)
        if (res.some(u => !u)) {
            const mes = getMesEl(id);
            if (mes) {
                const scope = mes.querySelector('.mes_block') || mes;
                let imgs = Array.from(scope.querySelectorAll('img[data-iig-instruction]'));
                if (imgs.length < slotCount) imgs = Array.from(scope.querySelectorAll('img')).filter(im => !im.closest('.svn-card'));
                for (let i = 0; i < slotCount; i++) {
                    if (res[i]) continue;
                    const img = imgs[i];
                    if (img) res[i] = normalizeSrc(img.currentSrc || img.getAttribute('src') || img.src || '');
                }
            }
        }
        return res;
    }

    // ── декорация сообщения: скрыть прозу + карточка-лаунчер ───────────
    function isVnMessage(id) {
        const ctx = getCtx(); const msg = ctx.chat && ctx.chat[id];
        if (!msg || msg.is_user) return false;
        const mes = msgSource(msg); // .mes + картинки из блоков ExtBlocks
        return VN_OPEN_RE.test(mes) || (getSettings().detectAnyImages !== false && hasImageTags(mes));
    }
    function buildCard(id) {
        const card = document.createElement('div');
        card.className = 'svn-card';
        card.dataset.mesid = String(id);
        card.innerHTML =
            `<span class="svn-card-ph"><i class="fa-solid fa-clapperboard"></i></span>
             <span class="svn-card-scrim"></span>
             <span class="svn-card-type"><i class="fa-solid fa-book-open"></i> Визуальная новелла</span>
             <span class="svn-card-badge"></span>
             <span class="svn-card-play"><i class="fa-solid fa-play"></i></span>
             <div class="svn-card-main">
                 <div class="svn-card-title">Визуальная новелла</div>
                 <div class="svn-card-sub">нажми, чтобы открыть</div>
                 <div class="svn-card-bar"><span></span></div>
             </div>`;
        // клик по карточке открывает плеер; если читали именно эту сцену — продолжаем с того кадра
        const open = (e) => { e.preventDefault(); e.stopPropagation(); const lp = lastReadStore()[stateKey()]; openPlayer(id, (lp && lp.mesId === id) ? lp.frame : 0); };
        card.addEventListener('click', open);
        return card;
    }
    function updateCard(mes, id) {
        const card = mes.querySelector('.svn-card'); if (!card) return;
        const scene = parseSceneCached(id); if (!scene) return;
        const nF = scene.frames.length, nI = scene.slots.length;
        const streaming = mes.classList.contains('svn-streaming');
        // заголовок-тизер: первая непустая реплика сцены (без markdown-маркеров)
        const titleEl = card.querySelector('.svn-card-title');
        if (titleEl) {
            const first = scene.frames.find(f => f.text && f.text.trim());
            const teaser = first ? first.text.replace(/[*_`~]+/g, '').trim() : '';
            titleEl.textContent = teaser || 'Визуальная новелла';
        }
        const sub = card.querySelector('.svn-card-sub');
        if (sub) {
            const lp = lastReadStore()[stateKey()];
            if (streaming)
                sub.innerHTML = `<span class="svn-spin"></span> печатается…`;
            else if (lp && lp.mesId === id && lp.frame > 0 && lp.frame < nF) // читали эту сцену не до конца → зовём продолжить
                sub.innerHTML = `<i class="fa-solid fa-bookmark"></i> продолжить · кадр ${lp.frame + 1}/${nF}`;
            else
                sub.textContent = `${nF} ${plural(nF, 'реплика', 'реплики', 'реплик')} · ${nI} ${plural(nI, 'кадр', 'кадра', 'кадров')}`;
        }
        // бейдж в углу: число сгенерированных кадров (или, пока их нет, число реплик)
        const badge = card.querySelector('.svn-card-badge');
        if (badge) {
            if (nI > 0) { badge.innerHTML = `<i class="fa-solid fa-film"></i> ${nI}`; badge.title = `${nI} ${plural(nI, 'кадр', 'кадра', 'кадров')}`; }
            else { badge.innerHTML = `<i class="fa-solid fa-comment-dots"></i> ${nF}`; badge.title = `${nF} ${plural(nF, 'реплика', 'реплики', 'реплик')}`; }
        }
        // полоска прочтения: какой максимальный кадр уже видели в плеере
        const bar = card.querySelector('.svn-card-bar');
        if (bar) {
            const seen = seenStore()[id];
            const max = (typeof seen === 'number') ? seen : -1;
            const pct = nF > 0 ? Math.max(0, Math.min(100, Math.round(((max + 1) / nF) * 100))) : 0;
            bar.firstElementChild.style.width = pct + '%';
            bar.classList.toggle('svn-done', pct >= 100 && !streaming);
            card.classList.toggle('svn-unread', max < 0 && !streaming);
        }
        // фон-постер на самой карточке
        const url = resolveImageUrls(id, scene.slots.length).find(u => u);
        const ph = card.querySelector('.svn-card-ph');
        if (url) { card.style.backgroundImage = `url("${cssUrl(url)}")`; card.classList.add('svn-has-img'); if (ph) ph.style.display = 'none'; }
        else { card.style.backgroundImage = ''; card.classList.remove('svn-has-img'); if (ph) ph.style.display = ''; }
    }
    function decorateMessage(id) {
        const mes = getMesEl(id); if (!mes) return;
        const s = getSettings();
        if (!s.enabled || !isVnMessage(id)) {
            if (mes.classList.contains('svn-directing')) return; // режиссёр ещё работает — не снимаем плашку «собираю кадры…»
            mes.classList.remove('svn-active');
            const old = mes.querySelector('.svn-card'); if (old) old.remove();
            return;
        }
        mes.classList.remove('svn-directing');
        const dc = mes.querySelector('.svn-card-directing'); if (dc) dc.remove(); // временную плашку убираем, строим настоящую карточку
        mes.classList.toggle('svn-active', !!s.hideMarkup);
        const block = mes.querySelector('.mes_block') || mes;
        if (!block.querySelector('.svn-card')) {
            const card = buildCard(id);
            const mesText = block.querySelector('.mes_text');
            if (mesText) mesText.insertAdjacentElement('afterend', card);
            else block.insertBefore(card, block.firstChild);
        }
        updateCard(mes, id);
        scheduleCardRefresh(id);
    }
    const _cardTimers = new Map();
    function scheduleCardRefresh(id) {
        if (_cardTimers.has(id)) return;
        let n = 0;
        const tick = () => {
            const mes = getMesEl(id); if (mes) updateCard(mes, id);
            if (player.open && player.mesId === id) { refreshImages(); renderSprites(); }
            if (++n >= 8) { clearInterval(t); _cardTimers.delete(id); }
        };
        const t = setInterval(tick, 2500);
        _cardTimers.set(id, t);
    }
    function decorateAll() {
        const chat = getCtx().chat || [];
        document.querySelectorAll('#chat .mes[mesid]').forEach(mes => {
            const id = parseInt(mes.getAttribute('mesid'), 10);
            if (!isNaN(id) && chat[id]) decorateMessage(id);
        });
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  ПЛЕЕР                                                          ║
    // ╚════════════════════════════════════════════════════════════════╝
    const player = {
        open: false, mesId: null, scene: null, frame: 0,
        dialogHidden: false, waiting: false, autoPlay: false,
        typing: false, fullText: '', fmtSegs: null, el: null,
        manualStage: {},       // ручной оверрайд каста: key -> { name, pos, emo, live }
        mgrStandalone: false,  // менеджер открыт без плеера (из настроек)
        rotated: false,        // принудительная горизонталь на телефоне (кнопка-поворот)
        panX: 50, canPan: false, // прокрутка широкого фона по горизонтали
        genFrame: -1, genSince: 0, // тайминг «генерируется…» текущего кадра (для детекта зависшей генерации)
    };
    let _bgActive = 0;
    let _typeTimer = null;
    let _autoTimer = null;
    let _spriteObs = null;
    let _imgPoll = null;   // пока плеер открыт — добираем медленно генерящиеся кадры (2K и т.п.)
    let _statusEmotion = ''; // эмоция {{char}} из <vn-status> (модуль «emotion»): двигает спрайт без <sprite>
    let _turnCoins = 0;      // сколько искр начислено за текущий ход (для модуля «Итог сцены»)
    let _turnApplied = new Map();    // mesId → swipe_id уже применённого хода (дедуп накопительных эффектов: искры/любовь/инвентарь)
    let _turnSnapshots = new Map();  // mesId → снапшот состояния модулей ДО хода последнего сообщения (для отката при пере-свайпе)
    let _choiceTimer = null; // таймаут авто-выбора (таймер на <choices>)
    function clearChoiceTimer() { if (_choiceTimer) { clearTimeout(_choiceTimer); _choiceTimer = null; } }

    function vnMessageIds() {
        const chat = getCtx().chat || [];
        const ids = [];
        for (let i = 0; i < chat.length; i++) if (chat[i] && !chat[i].is_user && VN_OPEN_RE.test(chat[i].mes || '')) ids.push(i);
        return ids;
    }

    function buildOverlay() {
        if (player.el) return player.el;
        const ov = document.createElement('div');
        ov.id = 'svn-overlay';
        ov.innerHTML =
`<div id="svn-bg-blur"></div>
<div id="svn-stage"><div class="svn-bg-layer"></div><div class="svn-bg-layer"></div></div>
<div id="svn-sprites"></div>
<div id="svn-panels"><button id="svn-panels-toggle" type="button" title="Скрыть панели"><i class="fa-solid fa-chevron-up"></i></button><div id="svn-panels-list"></div></div>
<div id="svn-vignette"></div>
<div id="svn-scrim"></div>
<div id="svn-lb-top" class="svn-lb"></div>
<div id="svn-lb-bot" class="svn-lb"></div>
<div id="svn-bg-note"><span class="svn-spin"></span><span>кадр генерируется…</span></div>
<div id="svn-click"></div>
<div class="svn-dialog" id="svn-dialog">
  <div class="svn-ctrl" id="svn-ctrl">
    <button class="svn-ib" data-act="prev" title="Назад (←)"><i class="fa-solid fa-chevron-left"></i></button>
    <button class="svn-ib" data-act="next" title="Вперёд (→ / пробел)"><i class="fa-solid fa-chevron-right"></i></button>
    <button class="svn-ib" data-act="auto" title="Автоплей"><i class="fa-solid fa-play"></i></button>
    <button class="svn-ib" data-act="skip" title="Промотать прочитанное (к новому)"><i class="fa-solid fa-forward-fast"></i></button>
    <button class="svn-ib" data-act="regen" title="Перерисовать кадр"><i class="fa-solid fa-rotate"></i></button>
    <button class="svn-ib" data-act="save" title="Сохранить кадр"><i class="fa-solid fa-download"></i></button>
    <button class="svn-ib" data-act="cast" title="Спрайты на сцене"><i class="fa-solid fa-users"></i></button>
    <button class="svn-ib" data-act="settings" title="Режимы и вид"><i class="fa-solid fa-sliders"></i></button>
    <button class="svn-ib" data-act="hide" title="Скрыть/показать диалог"><i class="fa-solid fa-eye"></i></button>
    <button class="svn-ib" data-act="log" title="История реплик (бэклог)"><i class="fa-solid fa-clock-rotate-left"></i></button>
    <button class="svn-ib" data-act="gallery" title="Галерея кадров"><i class="fa-solid fa-images"></i></button>
    <button class="svn-ib" data-act="music" title="Музыка / плейлист"><i class="fa-solid fa-music"></i></button>
    <button class="svn-ib" data-act="rotate" title="Повернуть в горизонталь (телефон)"><i class="fa-solid fa-mobile-screen-button"></i></button>
    <button class="svn-ib" data-act="prev-turn" title="Предыдущая сцена"><i class="fa-solid fa-backward-step"></i></button>
    <button class="svn-ib" data-act="next-turn" title="Следующая сцена"><i class="fa-solid fa-forward-step"></i></button>
    <button class="svn-ib svn-ctrl-toggle" data-act="collapse" title="Свернуть панель"><i class="fa-solid fa-angles-right"></i></button>
    <button class="svn-ib" data-act="close" title="Выход (Esc)"><i class="fa-solid fa-xmark"></i></button>
    <div class="svn-settings" id="svn-settings">
      <div class="svn-set-top">
        <span class="svn-set-title"><i class="fa-solid fa-sliders"></i> Режимы и вид</span>
        <button class="svn-set-x" data-set-close type="button" title="Закрыть" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="svn-set-head"><i class="fa-solid fa-swatchbook"></i> Тема</div>
      <div class="svn-set-grp">
        <label class="svn-set-row"><span>Готовая / своя тема</span><select data-theme-pick></select></label>
      </div>
      <div class="svn-set-head"><i class="fa-solid fa-table-columns"></i> Макет</div>
      <div class="svn-set-grp">
        <label class="svn-set-row"><span>Режим окна</span><select data-set="layoutMode"><option value="cinematic">Кинолента</option><option value="card">Плашка</option></select></label>
      </div>
      <div class="svn-set-head"><i class="fa-solid fa-clapperboard"></i> Сцена</div>
      <div class="svn-set-grp">
        <label class="svn-set-row"><span>Фон</span><select data-set="bgMode"><option value="generated">Генерация</option><option value="st">Фоны ST</option><option value="custom">Свой</option><option value="dim">Тёмный</option></select></label>
        <label class="svn-set-row"><span>Переход</span><select data-set="motion"><option value="none">Нет</option><option value="fade">Плавно</option><option value="cinematic">Кино (Ken Burns)</option><option value="pan">Промотка арта</option></select></label>
        <label class="svn-set-row svn-set-row-pan"><span>Скорость промотки</span><select data-set="panSpeed"><option value="60">очень медленно</option><option value="45">медленно</option><option value="32">обычно</option><option value="20">быстро</option><option value="12">очень быстро</option></select></label>
        <label class="svn-set-row"><span>Картинка</span><select data-set="imageFit"><option value="cover">Заполнять</option><option value="contain">Целиком</option></select></label>
        <label class="svn-set-row"><span>Кинорамка</span><input type="checkbox" data-set="letterbox"></label>
        <label class="svn-set-row"><span>Виньетка</span><input type="checkbox" data-set="vignette"></label>
      </div>
      <button class="svn-set-btn" data-set="pickbg"><i class="fa-solid fa-images"></i> Выбрать фон ST…</button>
      <div class="svn-set-head"><i class="fa-solid fa-font"></i> Текст и темп</div>
      <div class="svn-set-grp">
        <label class="svn-set-row"><span>Печать текста</span><input type="checkbox" data-set="typewriter"></label>
        <label class="svn-set-row"><span>Скорость текста</span><select data-set="typeSpeed"></select></label>
        <label class="svn-set-row"><span>Форматирование (*курсив*, **жирный**)</span><input type="checkbox" data-set="richText"></label>
        <label class="svn-set-row"><span>Выделять прямую речь («…»)</span><input type="checkbox" data-set="quoteHighlight"></label>
        <label class="svn-set-row"><span>Имя говорящего (по спрайту)</span><input type="checkbox" data-set="showSpeaker"></label>
        <label class="svn-set-row"><span>Темп автоплея</span><select data-set="autoSpeed"><option value="slow">медленно</option><option value="normal">обычно</option><option value="fast">быстро</option></select></label>
        <label class="svn-set-row"><span>Шрифт</span><select data-set="fontFamily"><option value="inherit">Как в ST</option><option value="sans">Без засечек</option><option value="serif">С засечками</option><option value="mono">Моноширинный</option><option value="round">Округлый</option><option value="cond">Узкий</option></select></label>
        <label class="svn-set-row"><span>Своё семейство</span><input type="text" data-set="customFont" placeholder="напр. Inter" style="max-width:140px;"></label>
        <label class="svn-set-row"><span>Межстрочный</span><select data-set="lineHeight"><option value="1.3">плотно</option><option value="1.5">1.5</option><option value="1.7">обычно</option><option value="1.9">свободно</option><option value="2.1">очень</option></select></label>
        <label class="svn-set-row"><span>Трекинг (буквы)</span><select data-set="letterSpacing"><option value="0">0</option><option value="0.3">обычно</option><option value="0.6">шире</option><option value="1">1px</option><option value="1.5">1.5px</option></select></label>
        <label class="svn-set-row"><span>Насыщенность</span><select data-set="textWeight"><option value="300">тонкий</option><option value="400">обычный</option><option value="500">средний</option><option value="600">полужирный</option><option value="700">жирный</option></select></label>
        <label class="svn-set-row"><span>Выравнивание</span><select data-set="textAlign"><option value="left">слева</option><option value="center">по центру</option><option value="justify">по ширине</option></select></label>
      </div>
      <div class="svn-set-head"><i class="fa-solid fa-display"></i> Окно</div>
      <div class="svn-set-grp">
        <label class="svn-set-row"><span>Размер шрифта</span><select data-set="fontSize"></select></label>
        <label class="svn-set-row"><span>Положение окна</span><select data-set="dialogPos"><option value="bottom">внизу</option><option value="top">вверху</option><option value="center">центр</option></select></label>
        <label class="svn-set-row"><span>Ширина окна</span><select data-set="dialogWidth"></select></label>
        <label class="svn-set-row"><span>Высота окна</span><select data-set="dialogHeight"></select></label>
        <label class="svn-set-row"><span>Матовость</span><select data-set="glass"></select></label>
        <label class="svn-set-row"><span>Скругление углов</span><select data-set="dialogRadius"><option value="0">0</option><option value="6">6</option><option value="12">12</option><option value="18">18</option><option value="22">22</option><option value="28">28</option></select></label>
        <label class="svn-set-row"><span>Толщина рамки</span><select data-set="dialogBorder"><option value="0">нет</option><option value="1">1px</option><option value="2">2px</option><option value="3">3px</option></select></label>
        <label class="svn-set-row"><span>Отступы</span><select data-set="dialogPad"><option value="12">тесно</option><option value="16">16</option><option value="20">обычно</option><option value="24">24</option><option value="28">просторно</option></select></label>
        <label class="svn-set-row"><span>Тень окна</span><select data-set="dialogShadow"><option value="none">нет</option><option value="soft">мягкая</option><option value="md">обычная</option><option value="strong">сильная</option></select></label>
        <label class="svn-set-row"><span>Размер кнопок</span><select data-set="ctrlSize"><option value="sm">меньше</option><option value="md">обычные</option><option value="lg">крупные</option></select></label>
      </div>
      <div class="svn-set-head"><i class="fa-solid fa-palette"></i> Цвета</div>
      <div class="svn-set-grp">
        <label class="svn-set-row"><span>Акцент интерфейса</span><input type="color" data-set="accentColor"></label>
        <label class="svn-set-row"><span>Цвет текста</span><input type="color" data-set="textColor"></label>
        <label class="svn-set-row"><span>Прямая речь</span><input type="color" data-set="speechColor"></label>
        <label class="svn-set-row"><span>Курсив (действия)</span><input type="color" data-set="italicColor"></label>
        <label class="svn-set-row"><span>Жирный</span><input type="color" data-set="boldColor"></label>
        <label class="svn-set-row"><span>Фон окна</span><input type="color" data-set="panelColor"></label>
        <label class="svn-set-row"><span>Имя говорящего</span><input type="color" data-set="speakerColor"></label>
        <label class="svn-set-row"><span>Цвет рамки</span><input type="color" data-set="borderColor"></label>
        <button class="svn-set-btn" data-set="resetColors"><i class="fa-solid fa-rotate-left"></i> Сбросить цвета</button>
      </div>
      <div class="svn-set-head"><i class="fa-solid fa-hand-pointer"></i> Управление</div>
      <div class="svn-set-grp">
        <label class="svn-set-row"><span>Листать тапом по экрану</span><input type="checkbox" data-set="tapAdvance"></label>
        <label class="svn-set-row"><span>Тинт акцента под настроение</span><input type="checkbox" data-set="moodTint"></label>
        <label class="svn-set-row"><span>Параллакс при смене кадра</span><input type="checkbox" data-set="parallax"></label>
        <label class="svn-set-row"><span>Всплывашки держатся</span><select data-set="floatHold"><option value="0.5">короче</option><option value="1">обычно</option><option value="1.8">дольше</option><option value="3">очень долго</option><option value="0">до клика</option></select></label>
      </div>
    </div>
    <div class="svn-settings svn-cast-panel" id="svn-cast-panel">
      <div class="svn-set-head">Спрайты на сцене</div>
      <label class="svn-set-row"><span>Авто-расстановка (ИИ)</span><input type="checkbox" data-castset="spriteAuto"></label>
      <label class="svn-set-row"><span>Фокус на говорящем</span><input type="checkbox" data-castset="speakerFocus"></label>
      <div class="svn-cast-list" id="svn-cast-list"></div>
      <div class="svn-cast-foot">
        <button class="svn-set-btn" data-cast="reset"><i class="fa-solid fa-rotate-left"></i> Сбросить к авто</button>
        <button class="svn-set-btn" data-cast="manage"><i class="fa-solid fa-masks-theater"></i> Менеджер спрайтов…</button>
      </div>
    </div>
  </div>
  <div class="svn-progress-row">
    <div class="svn-prog-bar"><span id="svn-prog-fill"></span></div>
    <div class="svn-progress" id="svn-progress"></div>
  </div>
  <div class="svn-speaker" id="svn-speaker"></div>
  <div class="svn-text" id="svn-text"></div>
  <div class="svn-continue" id="svn-continue" title="Дальше"><i class="fa-solid fa-chevron-down"></i></div>
  <div class="svn-controls">
    <div class="svn-status" id="svn-status"><span class="svn-spin"></span><span id="svn-status-text">Отправлено, жду ответ AI…</span></div>
    <input class="svn-input" id="svn-input" type="text" placeholder="Напиши ответ… Enter — отправить" />
    <span class="svn-tip" title="Enter — отправить · Esc — выход">↵</span>
  </div>
</div>
<div class="svn-picker" id="svn-picker"><div class="svn-picker-head"><span>Фоны SillyTavern</span><button class="svn-ib" data-pick="close"><i class="fa-solid fa-xmark"></i></button></div><div class="svn-picker-grid" id="svn-picker-grid"></div></div>
<div class="svn-mgr" id="svn-cast-mgr">
  <div class="svn-mgr-head">
    <span><i class="fa-solid fa-masks-theater"></i> Менеджер спрайтов</span>
    <div class="svn-mgr-head-btns">
      <button class="svn-set-btn" data-mgr="add"><i class="fa-solid fa-plus"></i> Персонаж</button>
      <button class="svn-ib" data-mgr="close"><i class="fa-solid fa-xmark"></i></button>
    </div>
  </div>
  <div class="svn-mgr-presets">Добавить: <button class="svn-chip" data-preset="{{char}}"><i class="fa-solid fa-star"></i> Персонаж</button><button class="svn-chip" data-preset="{{user}}"><i class="fa-solid fa-user"></i> Игрок</button><button class="svn-chip" data-preset="npc"><i class="fa-solid fa-users"></i> NPC</button></div>
  <div class="svn-mgr-body" id="svn-mgr-body"></div>
</div>
<div class="svn-sheet svn-bgm-sheet" id="svn-bgm">
  <div class="svn-sheet-head"><span><i class="fa-solid fa-music"></i> Музыка</span><button class="svn-ib" data-bgm="close"><i class="fa-solid fa-xmark"></i></button></div>
  <div class="svn-bgm-now" id="svn-bgm-now">
    <div class="svn-bgm-meta"><div class="svn-bgm-name" id="svn-bgm-name">Нет трека</div><div class="svn-bgm-artist" id="svn-bgm-artist"></div></div>
    <div class="svn-bgm-prog" id="svn-bgm-prog"><span id="svn-bgm-fill"></span></div>
    <div class="svn-bgm-time"><span id="svn-bgm-tc">0:00</span><span id="svn-bgm-td">0:00</span></div>
    <div class="svn-bgm-ctrl">
      <button class="svn-ib" data-bgm="mode" title="Режим"><i class="fa-solid fa-repeat"></i></button>
      <button class="svn-ib" data-bgm="prev" title="Назад"><i class="fa-solid fa-backward-step"></i></button>
      <button class="svn-ib svn-bgm-play" data-bgm="toggle" title="Играть/пауза"><i class="fa-solid fa-play"></i></button>
      <button class="svn-ib" data-bgm="next" title="Вперёд"><i class="fa-solid fa-forward-step"></i></button>
      <span class="svn-bgm-vol-w"><i class="fa-solid fa-volume-low"></i><input type="range" id="svn-bgm-vol" min="0" max="1" step="0.01"></span>
    </div>
  </div>
  <div class="svn-bgm-search"><input id="svn-bgm-search-input" class="svn-bgm-input" type="text" placeholder="Найти трек — «артист песня»…"><button id="svn-bgm-search-btn" class="svn-set-btn"><i class="fa-solid fa-magnifying-glass"></i> Найти</button></div>
  <div class="svn-bgm-results" id="svn-bgm-results"></div>
  <div class="svn-bgm-listhd">Плейлист этого чата</div>
  <div class="svn-bgm-list" id="svn-bgm-list"></div>
</div>
<div class="svn-sheet svn-backlog-sheet" id="svn-backlog">
  <div class="svn-sheet-head"><span><i class="fa-solid fa-clock-rotate-left"></i> История реплик</span><button class="svn-ib" data-bl="close"><i class="fa-solid fa-xmark"></i></button></div>
  <div class="svn-backlog-body" id="svn-backlog-body"></div>
  <button class="svn-bl-tolast" id="svn-bl-tolast" type="button" title="К последней реплике"><i class="fa-solid fa-arrow-down"></i> К последней</button>
</div>
<div class="svn-sheet svn-gallery-sheet" id="svn-gallery">
  <div class="svn-sheet-head"><span><i class="fa-solid fa-images"></i> Галерея кадров</span><button class="svn-ib" data-gal="close"><i class="fa-solid fa-xmark"></i></button></div>
  <div class="svn-gallery-grid" id="svn-gallery-grid"></div>
</div>`;
        document.body.appendChild(ov);
        player.el = ov;
        wireOverlay(ov);
        fillSettingSelects(ov);
        // выносим поповеры из полосы кнопок (.svn-ctrl с overflow+blur обрезает их на мобиле)
        const sEl = ov.querySelector('#svn-settings'); if (sEl) ov.appendChild(sEl);
        const cEl = ov.querySelector('#svn-cast-panel'); if (cEl) ov.appendChild(cEl);
        return ov;
    }

    function fillSettingSelects(ov) {
        const opt = (v, label, sel) => `<option value="${v}"${sel ? ' selected' : ''}>${label}</option>`;
        const s = getSettings();
        let h = '';
        for (let i = 12; i <= 30; i++) h += opt(i, i + 'px', i === s.fontSize);
        ov.querySelector('[data-set="fontSize"]').innerHTML = h;
        h = opt(0, 'авто', !s.dialogWidth);
        [360, 480, 600, 720, 880, 1000, 1200, 1440].forEach(w => h += opt(w, w + 'px', s.dialogWidth === w));
        ov.querySelector('[data-set="dialogWidth"]').innerHTML = h;
        h = opt(0, 'авто', !s.dialogHeight);
        [120, 160, 200, 260, 320, 420, 540].forEach(v => h += opt(v, v + 'px', s.dialogHeight === v));
        ov.querySelector('[data-set="dialogHeight"]').innerHTML = h;
        h = '';
        [0, 0.2, 0.35, 0.5, 0.62, 0.75, 0.88, 1].forEach(v => h += opt(v, Math.round(v * 100) + '%', Math.abs(s.glass - v) < 0.001));
        ov.querySelector('[data-set="glass"]').innerHTML = h;
        ov.querySelector('[data-set="imageFit"]').value = s.imageFit;
        ov.querySelector('[data-set="bgMode"]').value = s.bgMode;
        ov.querySelector('[data-set="motion"]').value = s.motion;
        const psSel = ov.querySelector('[data-set="panSpeed"]'); if (psSel) psSel.value = String(s.panSpeed || 32);
        ov.querySelector('[data-set="typewriter"]').checked = !!s.typewriter;
        ov.querySelector('[data-set="letterbox"]').checked = !!s.letterbox;
        ov.querySelector('[data-set="vignette"]').checked = !!s.vignette;
        // скорость текста
        const tsMap = [[45, 'медленно'], [26, 'обычная'], [16, 'быстро'], [8, 'очень быстро']];
        let th = '', tFound = false;
        tsMap.forEach(([v, l]) => { const sel = s.typeSpeed === v; if (sel) tFound = true; th += opt(v, l, sel); });
        if (!tFound) th = opt(s.typeSpeed, s.typeSpeed + ' мс', true) + th;
        ov.querySelector('[data-set="typeSpeed"]').innerHTML = th;
        ov.querySelector('[data-set="autoSpeed"]').value = s.autoSpeed || 'normal';
        ov.querySelector('[data-set="showSpeaker"]').checked = !!s.showSpeaker;
        { const rt = ov.querySelector('[data-set="richText"]'); if (rt) rt.checked = s.richText !== false; }
        { const qh = ov.querySelector('[data-set="quoteHighlight"]'); if (qh) qh.checked = s.quoteHighlight !== false; }
        for (const k of ['accentColor', 'textColor', 'speechColor', 'italicColor', 'boldColor', 'panelColor']) {
            const ce = ov.querySelector(`[data-set="${k}"]`); if (ce) ce.value = s[k] || DEFAULTS[k];
        }
        // ── расширенный вид: геометрия/типографика/UI (статичные опции → ставим value) ──
        const setSel = (k, val) => { const el = ov.querySelector(`[data-set="${k}"]`); if (el) el.value = String(val); };
        setSel('layoutMode', s.layoutMode || 'cinematic');
        setSel('dialogPos', s.dialogPos || 'bottom');
        setSel('textAlign', s.textAlign || 'left');
        setSel('dialogRadius', s.dialogRadius != null ? s.dialogRadius : 22);
        setSel('dialogBorder', s.dialogBorder != null ? s.dialogBorder : 1);
        setSel('dialogPad', s.dialogPad != null ? s.dialogPad : 20);
        setSel('dialogShadow', s.dialogShadow || 'md');
        setSel('ctrlSize', s.ctrlSize || 'md');
        setSel('fontFamily', s.fontFamily || 'inherit');
        setSel('lineHeight', s.lineHeight != null ? s.lineHeight : 1.7);
        setSel('letterSpacing', s.letterSpacing != null ? s.letterSpacing : 0.3);
        setSel('textWeight', s.textWeight || 400);
        { const cf = ov.querySelector('[data-set="customFont"]'); if (cf) cf.value = s.customFont || ''; }
        // новые цвета: пусто = «авто» (наследует акцент/дефолт), в свотче показываем эффективный цвет
        { const sc = ov.querySelector('[data-set="speakerColor"]'); if (sc) sc.value = s.speakerColor || s.accentColor || '#78aaff'; }
        { const bc = ov.querySelector('[data-set="borderColor"]'); if (bc) bc.value = s.borderColor || '#8a8a90'; }
        // компактный селект тем (только в плеере)
        { const tp = ov.querySelector('[data-theme-pick]'); if (tp) fillThemeSelect(tp); }
        // player-UX
        ov.querySelector('[data-set="tapAdvance"]').checked = s.tapAdvance !== false;
        ov.querySelector('[data-set="moodTint"]').checked = s.moodTint !== false;
        ov.querySelector('[data-set="parallax"]').checked = s.parallax !== false;
        const fhSel = ov.querySelector('[data-set="floatHold"]');
        if (fhSel) fhSel.value = String(typeof s.floatHold === 'number' ? s.floatHold : 1);
        syncPickBtn(ov);
        syncPanSpeedVis();
    }
    // строка «Скорость промотки» нужна только в режиме перехода «Промотка» — иначе прячем
    function syncPanSpeedVis() {
        const pan = getSettings().motion === 'pan';
        [document.getElementById('svn-cfg'), player.el].forEach(root => {
            if (!root) return;
            root.querySelectorAll('.svn-set-row-pan').forEach(r => { r.style.display = pan ? '' : 'none'; });
        });
    }
    function syncPickBtn(ov) {
        const btn = ov.querySelector('[data-set="pickbg"]');
        if (btn) btn.style.display = (getSettings().bgMode === 'st') ? '' : 'none';
    }
    // общая проводка контролов «вида/режимов» (data-set): и для листа в плеере,
    // и для вкладки «Вид и плеер» в панели настроек. Визуальные правки применяются
    // только если плеер открыт; настройки сохраняются всегда.
    function wireViewSettings(container) {
        container.querySelectorAll('[data-set]').forEach(el => {
            const key = el.dataset.set;
            if (key === 'pickbg') {
                el.addEventListener('click', () => {
                    if (!player.open) { toastr && toastr.info('Откройте плеер, чтобы выбрать фон ST', 'Визуальная новелла'); return; }
                    openBgPicker();
                });
                return;
            }
            if (key === 'resetColors') {
                el.addEventListener('click', () => {
                    const s = getSettings();
                    for (const k of ['accentColor', 'textColor', 'speechColor', 'italicColor', 'boldColor', 'panelColor', 'speakerColor', 'borderColor']) s[k] = DEFAULTS[k];
                    s.activeTheme = '';
                    saveSettings();
                    if (player.open) applyVisuals();
                    applyTheme();
                    for (const t of [document.getElementById('svn-cfg'), player.el && player.el.querySelector('#svn-settings')]) { if (t) try { fillSettingSelects(t); } catch (e) { /* ignore */ } }
                    refreshThemeUI();
                });
                return;
            }
            el.addEventListener('change', () => {
                const s = getSettings();
                if (el.type === 'checkbox') s[key] = el.checked;
                else if (key === 'glass' || key === 'floatHold' || key === 'lineHeight' || key === 'letterSpacing') s[key] = parseFloat(el.value);
                else if (key === 'fontSize' || key === 'dialogWidth' || key === 'dialogHeight' || key === 'typeSpeed' || key === 'panSpeed' || key === 'dialogRadius' || key === 'dialogBorder' || key === 'dialogPad' || key === 'textWeight') s[key] = parseInt(el.value, 10) || 0;
                else s[key] = el.value;
                if (THEME_KEYS.includes(key)) s.activeTheme = ''; // ручная правка вида → больше не «активная тема»
                saveSettings();
                if (key === 'bgMode') {
                    syncPickBtn(container);
                    if (player.open && s.bgMode === 'st' && !s.stBgUrl) openBgPicker();
                    if (s.bgMode === 'custom' && !s.hasCustomBg) pickBgFile(); // выбрал «Свой» без картинки → сразу предложить загрузить
                }
                if (player.open) { applyVisuals(); renderFrame(); }
                applyTheme(); // акцент/цвета — на плеер И на панель настроек, даже когда плеер закрыт
                syncOtherViewControls(container);
                if (key === 'motion') syncPanSpeedVis(); // показать/скрыть «Скорость промотки»
                refreshThemeUI(); // подсветка активной темы/селект могли измениться
            });
        });
    }
    // держим оба экземпляра контролов «вида» (плеер ↔ панель) в синхроне
    function syncOtherViewControls(changed) {
        const targets = [document.getElementById('svn-cfg'), player.el && player.el.querySelector('#svn-settings')];
        for (const t of targets) {
            if (!t || t === changed || !t.querySelector('[data-set]')) continue;
            try { fillSettingSelects(t); } catch (e) { /* ignore */ }
        }
    }

    function wireOverlay(ov) {
        ov.querySelector('#svn-click').addEventListener('click', () => {
            if (_didPan) return; // это был не тап, а протяжка фона — не листаем
            const st = ov.querySelector('#svn-settings'), cp = ov.querySelector('#svn-cast-panel');
            if ((st && st.classList.contains('svn-show')) || (cp && cp.classList.contains('svn-show'))) {
                if (st) st.classList.remove('svn-show');
                if (cp) cp.classList.remove('svn-show');
                return;
            }
            // диалог скрыт глазиком → первый тап/клик возвращает его (а не листает): и на ПК, и на телефоне
            if (player.dialogHidden) { toggleDialog(); return; }
            // «листать тапом по экрану» выключено → тап по сцене не листает (только стрелка/кнопки/клавиши)
            if (getSettings().tapAdvance === false) return;
            next();
        });
        wirePan(ov);
        ov.querySelector('#svn-ctrl').addEventListener('click', (e) => {
            const btn = e.target.closest('.svn-ib'); if (!btn) return;
            e.stopPropagation();
            const act = btn.dataset.act;
            ({
                prev, next, auto: toggleAuto, skip: skipSeen, regen: regenCurrent, save: saveCurrent,
                settings: toggleSettings, hide: toggleDialog, cast: toggleCastPanel, rotate: toggleRotate,
                log: toggleBacklog, music: openBgmSheet, gallery: toggleGallery,
                collapse: () => setCtrlCollapsed(!getSettings().ctrlCollapsed),
                'prev-turn': () => gotoTurn(-1), 'next-turn': () => gotoTurn(1), close: closePlayer,
            }[act] || (() => {}))();
        });
        const set = ov.querySelector('#svn-settings');
        set.addEventListener('click', e => e.stopPropagation());
        const setX = set.querySelector('[data-set-close]'); if (setX) setX.addEventListener('click', () => set.classList.remove('svn-show'));
        wireViewSettings(set);
        // компактный переключатель тем в плеере
        const tpick = set.querySelector('[data-theme-pick]');
        if (tpick) tpick.addEventListener('change', () => {
            const v = tpick.value;
            if (!v) return;
            if (v.indexOf('b:') === 0) applyBuiltinTheme(v.slice(2)); else applyUserPreset(v);
        });
        // панель каста
        const cp = ov.querySelector('#svn-cast-panel');
        cp.addEventListener('click', e => e.stopPropagation());
        cp.querySelectorAll('[data-castset]').forEach(el => {
            el.addEventListener('change', () => {
                const s = getSettings(); s[el.dataset.castset] = el.checked; saveSettings();
                if (el.dataset.castset === 'spriteAuto') updateInjection();
                renderSprites(); renderCastPanel();
            });
        });
        cp.querySelector('[data-cast="reset"]').addEventListener('click', () => { player.manualStage = {}; renderSprites(); renderCastPanel(); });
        cp.querySelector('[data-cast="manage"]').addEventListener('click', () => openCastManager(false));
        // пикер фонов
        const picker = ov.querySelector('#svn-picker');
        picker.addEventListener('click', e => { if (e.target === picker) closeBgPicker(); });
        picker.querySelector('[data-pick="close"]').addEventListener('click', closeBgPicker);
        // лист «Музыка»
        const bgmSheet = ov.querySelector('#svn-bgm');
        if (bgmSheet) {
            bgmSheet.addEventListener('click', e => { if (e.target === bgmSheet) closeBgmSheet(); });
            const bb = (sel, fn) => { const el = bgmSheet.querySelector(sel); if (el) el.addEventListener('click', fn); };
            bb('[data-bgm="close"]', closeBgmSheet); bb('[data-bgm="toggle"]', bgmToggle); bb('[data-bgm="prev"]', bgmPrev); bb('[data-bgm="next"]', bgmNext); bb('[data-bgm="mode"]', bgmCycleMode);
            const vol = bgmSheet.querySelector('#svn-bgm-vol'); if (vol) vol.addEventListener('input', e => bgmSetVol(parseFloat(e.target.value)));
            const prog = bgmSheet.querySelector('#svn-bgm-prog');
            if (prog) prog.addEventListener('click', e => { const a = bgm.audio; if (!a || !a.duration) return; const r = prog.getBoundingClientRect(); a.currentTime = (e.clientX - r.left) / r.width * a.duration; });
            const sInput = bgmSheet.querySelector('#svn-bgm-search-input'), sBtn = bgmSheet.querySelector('#svn-bgm-search-btn');
            const doSearch = async () => {
                const q = sInput.value.trim(); if (!q) return;
                sBtn.disabled = true; bgmEnsureAudio();
                const box = ov.querySelector('#svn-bgm-results'); if (box) box.innerHTML = '<div class="svn-bgm-empty"><span class="svn-spin"></span> ищу…</div>';
                const r = await bgmSearch(q); bgmRenderResults(r); sBtn.disabled = false;
            };
            if (sBtn) sBtn.addEventListener('click', doSearch);
            if (sInput) sInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } e.stopPropagation(); });
            const results = bgmSheet.querySelector('#svn-bgm-results');
            if (results) results.addEventListener('click', e => {
                const p = e.target.closest('[data-play]'), a = e.target.closest('[data-add]');
                if (p) { const t = bgm.results[+p.dataset.play]; if (t) bgmAdd(t, true); }
                else if (a) { const t = bgm.results[+a.dataset.add]; if (t) bgmAdd(t, false); }
            });
            const plist = bgmSheet.querySelector('#svn-bgm-list');
            if (plist) plist.addEventListener('click', e => {
                const x = e.target.closest('[data-del]'); if (x) { e.stopPropagation(); bgmRemove(+x.dataset.del); return; }
                const row = e.target.closest('.svn-bgm-row'); if (row) bgmPlay(bgmList()[+row.dataset.i], +row.dataset.i);
            });
        }
        // лист «История» (бэклог)
        const blSheet = ov.querySelector('#svn-backlog');
        if (blSheet) {
            blSheet.addEventListener('click', e => { if (e.target === blSheet) closeBacklog(); });
            const blClose = blSheet.querySelector('[data-bl="close"]'); if (blClose) blClose.addEventListener('click', closeBacklog);
            const blBody = blSheet.querySelector('#svn-backlog-body');
            if (blBody) blBody.addEventListener('click', e => { const r = e.target.closest('.svn-bl-row'); if (r) backlogJump(+r.dataset.mes, +r.dataset.frame); });
            blSheet.addEventListener('scroll', updateBacklogToLast, { passive: true });
            const blLast = blSheet.querySelector('#svn-bl-tolast');
            if (blLast) blLast.addEventListener('click', (e) => { e.stopPropagation(); backlogToLast(); });
        }
        // лист «Галерея»
        const galSheet = ov.querySelector('#svn-gallery');
        if (galSheet) {
            galSheet.addEventListener('click', e => { if (e.target === galSheet) closeGallery(); });
            const galClose = galSheet.querySelector('[data-gal="close"]'); if (galClose) galClose.addEventListener('click', closeGallery);
            const galGrid = galSheet.querySelector('#svn-gallery-grid');
            if (galGrid) galGrid.addEventListener('click', e => { const it = e.target.closest('.svn-gal-item'); if (it) galleryJump(+it.dataset.mes, +it.dataset.slot); });
        }
        // менеджер спрайтов
        wireCastManager(ov);
        // тумблер «свернуть панели модулей» (чтобы спрятать весь HUD)
        const ptog = ov.querySelector('#svn-panels-toggle');
        if (ptog) ptog.addEventListener('click', (e) => { e.stopPropagation(); setPanelsCollapsed(!getSettings().panelsCollapsed); });
        // диалог не проматывает кадр
        ov.querySelector('#svn-dialog').addEventListener('click', e => e.stopPropagation());
        // стрелка «дальше» — единственное в диалоге, что листает
        const cont = ov.querySelector('#svn-continue');
        if (cont) cont.addEventListener('click', (e) => { e.stopPropagation(); next(); });
        const input = ov.querySelector('#svn-input');
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); sendFromPlayer(); } e.stopPropagation(); });
        input.addEventListener('click', e => e.stopPropagation());
    }

    function onKeydown(e) {
        if (!player.open && !player.mgrStandalone) return;
        if (e.target && (e.target.id === 'svn-input' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) {
            if (e.key === 'Escape') e.target.blur();
            return;
        }
        const mgrOpen = player.el && player.el.querySelector('#svn-cast-mgr').classList.contains('svn-show');
        const pickOpen = player.el && player.el.querySelector('#svn-picker').classList.contains('svn-show');
        const bgmOpen = player.el && player.el.querySelector('#svn-bgm').classList.contains('svn-show');
        const blOpen = player.el && player.el.querySelector('#svn-backlog').classList.contains('svn-show');
        const galOpen = player.el && player.el.querySelector('#svn-gallery').classList.contains('svn-show');
        const anySheet = mgrOpen || pickOpen || bgmOpen || blOpen || galOpen;
        if (e.key === 'Escape') {
            e.preventDefault();
            if (mgrOpen) closeCastManager();
            else if (pickOpen) closeBgPicker();
            else if (bgmOpen) closeBgmSheet();
            else if (blOpen) closeBacklog();
            else if (galOpen) closeGallery();
            else closePlayer();
        } else if (!anySheet && player.open && (e.key === 'ArrowRight' || e.key === ' ')) { e.preventDefault(); next(); }
        else if (!anySheet && player.open && e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    }

    function openPlayer(id, startFrame) {
        const msg = (getCtx().chat || [])[id]; if (!msg) return;
        const scene = parseScene(msgSource(msg));
        if (!scene) { toastr && toastr.info('В этом сообщении нет <vn>-сцены', 'Визуальная новелла'); return; }
        buildOverlay();
        player.open = true; player.mesId = id; player.scene = scene; player.waiting = false;
        player.frame = Math.max(0, Math.min(parseInt(startFrame, 10) || 0, scene.frames.length - 1)); // 0 по умолчанию; >0 — продолжить с места
        player.manualStage = {};
        player.el.classList.add('svn-show');
        // поворот сохраняется при переходе между сценами; пан начинается с центра
        player.el.classList.toggle('svn-rotated', player.rotated);
        const _rb = player.el.querySelector('[data-act="rotate"]'); if (_rb) _rb.classList.toggle('svn-ib-active', player.rotated);
        resetPan();
        document.body.classList.add('svn-lock');
        document.addEventListener('keydown', onKeydown, true);
        loadSpriteCache().then(() => { if (player.open && player.mesId === id) renderSprites(); });
        { const s = getSettings(); if (s.bgMode === 'custom' && s.hasCustomBg && !customBgUrl()) loadCustomBg().then(() => { if (player.open) renderFrame(); }); }
        applyVisuals(); updateAutoBtn(); ensureSpriteObserver();
        renderFrame();
        engineOnOpen();
        clearInterval(_imgPoll);
        _imgPoll = setInterval(() => { if (player.open) refreshImages(); else { clearInterval(_imgPoll); _imgPoll = null; } }, 2000);
    }
    function closePlayer() {
        if (!player.open) return;
        player.open = false; player.waiting = false; player.autoPlay = false;
        clearTimeout(_autoTimer); clearInterval(_typeTimer); _typeTimer = null;
        clearInterval(_imgPoll); _imgPoll = null;
        if (player.el) {
            player.el.classList.remove('svn-show');
            player.el.querySelector('#svn-status').classList.remove('svn-show');
            player.el.querySelector('#svn-settings').classList.remove('svn-show');
            player.el.querySelector('#svn-cast-panel').classList.remove('svn-show');
            player.el.querySelector('#svn-cast-mgr').classList.remove('svn-show');
            player.el.querySelector('#svn-bgm').classList.remove('svn-show');        // музыка продолжает играть, лист просто закрыт
            player.el.querySelector('#svn-backlog').classList.remove('svn-show');
            player.el.querySelector('#svn-gallery').classList.remove('svn-show');
            player.el.querySelectorAll('.svn-bg-layer').forEach(l => { l.classList.remove('svn-on'); l.dataset.url = ''; });
            const sp = player.el.querySelector('#svn-sprites'); if (sp) sp.innerHTML = '';
            const pn = player.el.querySelector('#svn-panels-list'); if (pn) pn.innerHTML = '';
            const pnRoot = player.el.querySelector('#svn-panels'); if (pnRoot) pnRoot.classList.remove('svn-has-panels');
            const ch = player.el.querySelector('#svn-choices'); if (ch) ch.remove();
            const rc = player.el.querySelector('#svn-recap'); if (rc) rc.remove();
            clearChoiceTimer();
            const fl = player.el.querySelector('#svn-floats'); if (fl) fl.innerHTML = '';
            player.el.classList.remove('svn-rotated'); // следующее открытие — снова вертикально
        }
        player.rotated = false; player.canPan = false;
        document.body.classList.remove('svn-lock');
        document.removeEventListener('keydown', onKeydown, true);
    }

    function applyVisuals() {
        const ov = player.el; if (!ov) return;
        const s = getSettings();
        const dlg = ov.querySelector('#svn-dialog');
        const txt = ov.querySelector('#svn-text');
        txt.style.fontSize = s.fontSize + 'px';
        dlg.style.width = s.dialogWidth ? (s.dialogWidth + 'px') : '';
        txt.style.maxHeight = s.dialogHeight ? (s.dialogHeight + 'px') : '';
        txt.style.overflowY = s.dialogHeight ? 'auto' : '';
        const [pr, pg, pb] = svnHexRgb(s.panelColor || '#141416');
        dlg.style.background = `rgba(${pr},${pg},${pb},${s.glass})`;
        ov.style.setProperty('--svn-scrim-rgb', `${pr}, ${pg}, ${pb}`); // скрим киноленты красится в цвет окна темы → светлые темы (сепия) остаются читаемыми
        applyFmtVars(ov, s); // цвета текста/речи/курсива/жирного
        ov.classList.toggle('svn-letterbox', !!s.letterbox);
        ov.classList.toggle('svn-vignette-on', !!s.vignette);
        ov.classList.toggle('svn-mode-cinematic', s.layoutMode === 'cinematic');
        ov.classList.toggle('svn-mode-card', s.layoutMode !== 'cinematic');
        const fit = (s.imageFit === 'contain') ? 'contain' : 'cover';
        ov.querySelectorAll('.svn-bg-layer').forEach(l => { l.style.backgroundSize = fit; });
        // ── полный кастомайз вида: геометрия окна / типографика / UI ──
        const setv = (el, k, v) => { if (v == null || v === '') el.style.removeProperty(k); else el.style.setProperty(k, v); };
        ['svn-pos-bottom', 'svn-pos-top', 'svn-pos-center'].forEach(c => dlg.classList.remove(c));
        dlg.classList.add('svn-pos-' + (['top', 'center'].includes(s.dialogPos) ? s.dialogPos : 'bottom'));
        setv(dlg, '--svn-radius', (s.dialogRadius != null ? s.dialogRadius : 22) + 'px');
        setv(dlg, '--svn-border', (s.dialogBorder != null ? s.dialogBorder : 1) + 'px');
        setv(dlg, '--svn-border-color', s.borderColor || '');
        setv(dlg, '--svn-pad', (s.dialogPad != null ? s.dialogPad : 20) + 'px');
        setv(dlg, '--svn-shadow', SHADOW_VALS[s.dialogShadow] || SHADOW_VALS.md);
        setv(ov, '--svn-font', fontStackOf(s)); // на overlay → шрифт тянут и реплики, и панели HUD
        setv(txt, '--svn-line', s.lineHeight != null ? String(s.lineHeight) : '1.7');
        setv(txt, '--svn-track', (s.letterSpacing != null ? s.letterSpacing : 0.3) + 'px');
        setv(txt, '--svn-weight', String(s.textWeight || 400));
        setv(txt, '--svn-align', s.textAlign || 'left');
        setv(ov, '--svn-ib-size', (CTRL_SIZES[s.ctrlSize] || 36) + 'px');
        setv(ov, '--svn-speaker-color', s.speakerColor || '');
        setv(ov, '--svn-theme-accent', s.accentColor || '#78aaff'); // стабильный акцент темы для поверхностей HUD (не mood-тинт)
        const panDur = Math.max(6, Math.min(120, parseInt(s.panSpeed, 10) || 32)); // скорость авто-промотки → длительность анимации
        ov.style.setProperty('--svn-pan-dur', panDur + 's');
        updateCtrlChrome(); // восстановить свёрнутую/развёрнутую панель управления
        measurePan(); // режим «целиком» убирает горизонтальный выход за край → пан недоступен
        refreshMotion(false); // вкл/выкл авто-промотку под текущий режим перехода (без перезапуска, если уже катится)
    }

    // ── поворот в горизонталь (телефон) ───────────────────────────────
    function toggleRotate() {
        const ov = player.el; if (!ov) return;
        player.rotated = !player.rotated;
        ov.classList.toggle('svn-rotated', player.rotated);
        const btn = ov.querySelector('[data-act="rotate"]');
        if (btn) btn.classList.toggle('svn-ib-active', player.rotated);
        measurePan(); // размеры сцены поменялись — пересчитать возможность прокрутки фона
    }

    // ── горизонтальная прокрутка (пан) широкого фона ──────────────────
    let _didPan = false;            // последний жест был протяжкой, а не тапом (гасим листание)
    const _panNatural = {};         // url -> { w, h } натуральные размеры (для расчёта выхода за край)
    function setPanX(p) {
        player.panX = Math.max(0, Math.min(100, p));
        const ov = player.el; if (!ov) return;
        ov.querySelectorAll('.svn-bg-layer').forEach(l => l.style.setProperty('--svn-bgx', player.panX + '%'));
    }
    function setPanY(p) {
        player.panY = Math.max(0, Math.min(100, p));
        const ov = player.el; if (!ov) return;
        ov.querySelectorAll('.svn-bg-layer').forEach(l => l.style.setProperty('--svn-bgy', player.panY + '%'));
    }
    function resetPan() { setPanX(50); setPanY(50); }
    function panUrlSrc(url) {
        if (!url) return '';
        if (!isCssUrlString(url)) return url;
        const m = url.match(/url\(["']?([^"')]+)["']?\)/i); return m ? m[1] : '';
    }
    function measurePan() {
        const ov = player.el; if (!ov) return;
        const click = ov.querySelector('#svn-click');
        // axis: '' нет пана | 'x' тянем по горизонтали | 'y' по вертикали
        const setCan = (axis) => { player.panAxis = axis || ''; player.canPan = !!axis; if (click) click.classList.toggle('svn-can-pan', !!axis); if (!axis) resetPan(); };
        const s = getSettings();
        if (s.motion === 'pan') { setCan(''); return; } // авто-промотка сама гоняет фон — ручной пан выключаем
        const layers = ov.querySelectorAll('.svn-bg-layer');
        const url = (layers[_bgActive] && layers[_bgActive].dataset.url) || '';
        if (!url || s.imageFit === 'contain') { setCan(''); return; }
        const src = panUrlSrc(url);
        if (!src) { setCan(''); return; }
        const nat = _panNatural[src];
        if (!nat) { // натуральные размеры ещё не знаем — узнаём и перемеряем
            const im = new Image();
            im.onload = () => { _panNatural[src] = { w: im.naturalWidth || im.width || 1, h: im.naturalHeight || im.height || 1 }; if (player.open) measurePan(); };
            im.onerror = () => { _panNatural[src] = { w: 1, h: 1 }; };
            im.src = src;
            return;
        }
        // background-size: cover масштабирует картинку, чтобы ПОКРЫТЬ сцену (scale = max по осям).
        // За край выпирает та сторона, у которой запас больше — по ней и разрешаем тянуть.
        // На телефоне (узкий экран, 16:9 арт) выпирает ширина → 'x'; на ПК (широкое окно) — высота → 'y'.
        const cw = ov.clientWidth || 1, ch = ov.clientHeight || 1;
        const scale = Math.max(cw / (nat.w || 1), ch / (nat.h || 1));
        const overX = (nat.w || 1) * scale - cw, overY = (nat.h || 1) * scale - ch;
        if (overX <= 6 && overY <= 6) { setCan(''); return; } // картинка вписана впритык — двигать некуда
        setCan(overX >= overY ? 'x' : 'y');
    }
    // ── авто-промотка арта (режим motion='pan'): как в новеллах ────────
    // вертикальный (портретный) арт вылезает по высоте → катим ВВЕРХ-ВНИЗ;
    // горизонтальный (шире кадра) → катим ВЛЕВО-ВПРАВО. Ось определяем по тому,
    // какая сторона картинки не вмещается в сцену при background-size: cover.
    function refreshMotion(force) {
        const ov = player.el; if (!ov) return;
        const s = getSettings();
        const layer = ov.querySelectorAll('.svn-bg-layer')[_bgActive];
        if (!layer) return;
        const clear = () => layer.classList.remove('svn-pan-x', 'svn-pan-y');
        if (s.motion !== 'pan' || s.imageFit === 'contain') { clear(); return; }
        const src = panUrlSrc(layer.dataset.url || '');
        if (!src) { clear(); return; }
        const nat = _panNatural[src];
        if (!nat) { // натуральные размеры ещё не знаем — узнаём и применяем потом
            const im = new Image();
            im.onload = () => { _panNatural[src] = { w: im.naturalWidth || im.width || 1, h: im.naturalHeight || im.height || 1 }; if (player.open) refreshMotion(force); };
            im.onerror = () => { _panNatural[src] = { w: 1, h: 1 }; };
            im.src = src;
            return;
        }
        const cw = ov.clientWidth || 1, ch = ov.clientHeight || 1;
        const arImg = (nat.w || 1) / (nat.h || 1), arBox = cw / ch;
        const want = (arImg > arBox * 1.03) ? 'svn-pan-x' : (arImg < arBox * 0.97) ? 'svn-pan-y' : '';
        if (!force && want && layer.classList.contains(want)) return; // уже катится в нужную сторону — не перезапускаем
        clear();
        if (want) { void layer.offsetWidth; layer.classList.add(want); }
    }
    function wirePan(ov) {
        const el = ov.querySelector('#svn-click'); if (!el) return;
        let active = false, sx = 0, sy = 0, startPan = 50, moved = false;
        const TH = 8;
        const onY = () => player.panAxis === 'y';
        el.addEventListener('pointerdown', (e) => {
            if (!player.canPan) return;
            active = true; moved = false; sx = e.clientX; sy = e.clientY;
            startPan = onY() ? (player.panY != null ? player.panY : 50) : (player.panX != null ? player.panX : 50);
        });
        el.addEventListener('pointermove', (e) => {
            if (!active) return;
            const dx = e.clientX - sx, dy = e.clientY - sy;
            // в повёрнутом режиме (телефон) экран лежит на боку → оси картинки и экрана меняются местами
            const along = onY() ? (player.rotated ? dx : dy) : (player.rotated ? dy : dx);
            if (!moved && Math.abs(along) < TH) return;
            moved = true; _didPan = true;
            try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
            const span = (onY() ? (player.rotated ? ov.clientWidth : ov.clientHeight) : (player.rotated ? ov.clientHeight : ov.clientWidth)) || 1;
            // тянем как фотографию: ведём вправо/вниз → открывается левая/верхняя часть → позиция уменьшается
            const np = startPan - (along / span) * 100 * 1.4;
            if (onY()) setPanY(np); else setPanX(np);
        });
        const end = () => { active = false; setTimeout(() => { _didPan = false; }, 40); };
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
    }

    // ── фон (кроссфейд + Ken Burns) ───────────────────────────────────
    function setBlur(url) {
        const blur = player.el.querySelector('#svn-bg-blur');
        blur.style.backgroundImage = url ? bgImageValue(url) : '';
    }
    function setBackground(url) {
        const ov = player.el;
        const layers = ov.querySelectorAll('.svn-bg-layer');
        const cur = layers[_bgActive];
        const s = getSettings();
        if ((cur.dataset.url || '') === (url || '')) { setBlur(url); return; }
        if (!url) { layers.forEach(l => { l.classList.remove('svn-on'); l.dataset.url = ''; l.style.backgroundImage = ''; }); setBlur(''); player.canPan = false; const cl = ov.querySelector('#svn-click'); if (cl) cl.classList.remove('svn-can-pan'); return; }
        const next = layers[_bgActive ^ 1];
        next.style.backgroundSize = (s.imageFit === 'contain') ? 'contain' : 'cover';
        next.style.backgroundImage = bgImageValue(url);
        next.dataset.url = url;
        // перезапуск анимации Ken Burns
        next.classList.remove('svn-kb'); void next.offsetWidth;
        next.classList.toggle('svn-kb', s.motion === 'cinematic');
        next.classList.toggle('svn-instant', s.motion === 'none');
        cur.classList.toggle('svn-instant', s.motion === 'none');
        next.classList.add('svn-on');
        cur.classList.remove('svn-on');
        _bgActive ^= 1;
        setBlur(url);
        resetPan(); measurePan(); // новый кадр — пан в центр, пересчитать доступность
        refreshMotion(true);       // новый кадр — перезапустить авто-промотку в нужную сторону
    }
    function currentStBg() {
        const s = getSettings();
        if (s.stBgUrl) return s.stBgUrl;
        // текущий фон таверны
        try {
            const bg1 = document.getElementById('bg1');
            const v = bg1 && getComputedStyle(bg1).backgroundImage;
            if (v && v !== 'none') return v;
        } catch (e) { /* ignore */ }
        return null;
    }
    function frameBgUrl() {
        const s = getSettings();
        if (s.bgMode === 'dim') return null;
        if (s.bgMode === 'st') return currentStBg();
        if (s.bgMode === 'custom') return customBgUrl(); // свой загруженный фон (dataURL из IndexedDB)
        return bestImageUrl(); // generated — с подстраховкой, чтобы фон не моргал в чёрноту
    }
    // картинка ИМЕННО этого кадра (или null, если своей нет/ещё генерится) — для индикатора «генерируется…»
    function currentImageUrl() {
        if (!player.scene) return null;
        const f = player.scene.frames[player.frame];
        if (!f || f.imageIndex < 0) return null;
        const urls = resolveImageUrls(player.mesId, player.scene.slots.length);
        return urls[f.imageIndex] || null;
    }
    // фон для показа: своя картинка кадра; если её нет — держим ПОСЛЕДНЮЮ показанную (идём назад),
    // иначе первую доступную (вперёд). Кадры без своей картинки (текст до первого кадра или ещё не
    // сгенерированная) больше не превращаются в чёрный экран.
    function bestImageUrl() {
        if (!player.scene) return null;
        const urls = resolveImageUrls(player.mesId, player.scene.slots.length);
        const frames = player.scene.frames;
        const start = Math.min(player.frame, frames.length - 1);
        for (let i = start; i >= 0; i--) {
            const idx = frames[i] ? frames[i].imageIndex : -1;
            if (idx >= 0 && urls[idx]) return urls[idx];
        }
        for (const u of urls) if (u) return u;
        return null;
    }
    // упала ли генерация k-го кадра: sillyimages/megarakk помечает <img> классом iig-error-image (src=…/error.svg)
    function frameImageFailed(k) {
        if (!(k >= 0)) return false;
        const mes = getMesEl(player.mesId); if (!mes) return false;
        const scope = mes.querySelector('.mes_block') || mes;
        let imgs = Array.from(scope.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]'));
        if (imgs.length <= k) imgs = Array.from(scope.querySelectorAll('img')).filter(im => !im.closest('.svn-card'));
        const el = imgs[k];
        return !!(el && el.classList && el.classList.contains('iig-error-image'));
    }
    // состояние картинки ТЕКУЩЕГО кадра: 'na' (не нужна/не режим генерации) | 'ready' | 'generating' | 'failed'
    function currentFrameImageState() {
        if (getSettings().bgMode !== 'generated') return 'na';
        const f = player.scene && player.scene.frames[player.frame];
        if (!f || f.imageIndex < 0 || player.scene.slots.length <= f.imageIndex) return 'na';
        if (currentImageUrl()) return 'ready';
        if (frameImageFailed(f.imageIndex)) return 'failed';
        return 'generating';
    }
    const SVN_GEN_STUCK_MS = 30000; // столько «генерируется…» без результата → предлагаем «Повторить» (вдруг API молча сдох / не настроен)
    // индикатор кадра: спиннер «генерируется…», либо «не сгенерировался — Повторить» при провале/зависании
    function updateBgNote() {
        const ov = player.el; if (!ov) return;
        const note = ov.querySelector('#svn-bg-note'); if (!note) return;
        let st = currentFrameImageState();
        if (st === 'generating') {
            if (player.genFrame !== player.frame) { player.genFrame = player.frame; player.genSince = Date.now(); }
            if (Date.now() - (player.genSince || 0) > SVN_GEN_STUCK_MS) st = 'stuck';
        } else { player.genFrame = -1; player.genSince = 0; }
        if (st === 'na' || st === 'ready') { note.classList.remove('svn-show', 'svn-note-fail'); return; }
        if (st === 'generating') {
            note.classList.remove('svn-note-fail');
            note.innerHTML = `<span class="svn-spin"></span><span>кадр генерируется…</span>`;
            note.classList.add('svn-show');
            return;
        }
        // failed | stuck — больше не крутим спиннер вечно, даём повтор
        note.classList.add('svn-show', 'svn-note-fail');
        const txt = st === 'failed' ? 'кадр не сгенерировался' : 'генерация затянулась';
        note.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>${txt}</span><button type="button" class="svn-note-retry"><i class="fa-solid fa-rotate-right"></i> Повторить</button>`;
        const btn = note.querySelector('.svn-note-retry');
        if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); regenCurrent(); });
    }

    // ── форматирование реплик ─────────────────────────────────────────
    // Разбираем текст в сегменты со СТЕКОМ классов (поддержка вложенности: *курсив* внутри «речи» и т.п.).
    //  • *…* → курсив, **…** → жирный (если richText)
    //  • «…» / "…" / “…” → прямая речь, акцентный цвет (если quoteHighlight); кавычки остаются видимыми
    // Сегмент = { cls:[классы], s:'видимый текст' }. Маркеры */** скрываются, кавычки — нет.
    function formatSegments(raw) {
        raw = String(raw || '');
        const s = getSettings();
        const md = s.richText !== false, q = s.quoteHighlight !== false;
        const segs = [], stack = []; let buf = '';
        const flush = () => { if (buf) { segs.push({ cls: stack.slice(), s: buf }); buf = ''; } };
        const toggle = (c) => { flush(); const i = stack.lastIndexOf(c); if (i >= 0) stack.splice(i, 1); else stack.push(c); };
        const open = (c) => { flush(); stack.push(c); };
        const close = (c) => { flush(); const i = stack.lastIndexOf(c); if (i >= 0) stack.splice(i, 1); };
        for (let i = 0; i < raw.length; i++) {
            const ch = raw[i];
            if (md && ch === '*' && raw[i + 1] === '*') { toggle('b'); i++; continue; }
            if (md && ch === '*') { toggle('i'); continue; }
            if (q && (ch === '«' || ch === '“' || ch === '„')) { open('q'); buf += ch; continue; }
            if (q && (ch === '»' || ch === '”')) { buf += ch; close('q'); continue; }
            if (q && ch === '"') { if (stack.includes('q')) { buf += ch; toggle('q'); } else { toggle('q'); buf += ch; } continue; }
            buf += ch;
        }
        flush();
        return segs;
    }
    // HTML по сегментам, показывая первые `limit` видимых символов (limit==null → все). Теги корректно вложены.
    function segmentsHtml(segs, limit) {
        const tag = (c) => c === 'b' ? 'strong' : c === 'i' ? 'em' : null; // q → span.svn-q
        const op = (c) => c === 'q' ? '<span class="svn-q">' : '<' + tag(c) + '>';
        const cl = (c) => c === 'q' ? '</span>' : '</' + tag(c) + '>';
        let out = '', count = 0; const unlimited = (limit == null);
        for (const seg of segs) {
            let txt = seg.s;
            if (!unlimited) { if (count >= limit) break; const room = limit - count; if (txt.length > room) txt = txt.slice(0, room); count += txt.length; }
            out += seg.cls.map(op).join('') + escapeHtml(txt) + seg.cls.slice().reverse().map(cl).join('');
        }
        return out;
    }

    // ── текст (печатная машинка) ──────────────────────────────────────
    function setText(full) {
        const el = player.el.querySelector('#svn-text');
        clearInterval(_typeTimer); _typeTimer = null;
        player.fullText = full || '';
        const segs = formatSegments(player.fullText); player.fmtSegs = segs;
        const total = segs.reduce((n, x) => n + x.s.length, 0);
        if (!getSettings().typewriter || !total) { el.innerHTML = segmentsHtml(segs); player.typing = false; updateContinue(); return; }
        el.innerHTML = ''; player.typing = true; updateContinue();
        let i = 0; const speed = Math.max(8, getSettings().typeSpeed || 26);
        _typeTimer = setInterval(() => {
            i += 1; el.innerHTML = segmentsHtml(segs, i);
            if (i >= total) { clearInterval(_typeTimer); _typeTimer = null; player.typing = false; updateContinue(); }
        }, speed);
    }
    function completeText() {
        if (_typeTimer) { clearInterval(_typeTimer); _typeTimer = null; }
        if (player.el) player.el.querySelector('#svn-text').innerHTML = segmentsHtml(player.fmtSegs || formatSegments(player.fullText));
        player.typing = false; updateContinue();
    }
    // индикатор «жми дальше» (классическая VN-стрелка): виден, когда реплика допечатана и ждём клик
    function updateContinue() {
        const ov = player.el; if (!ov) return;
        const c = ov.querySelector('#svn-continue'); if (!c) return;
        const last = !!(player.scene && player.frame >= player.scene.frames.length - 1);
        const show = player.open && !player.typing && !player.dialogHidden && !player.waiting && !last;
        c.classList.toggle('svn-show', show);
    }
    // имя говорящего (бокс над текстом) — берём активного актёра кадра
    function updateSpeaker(f) {
        const spk = player.el && player.el.querySelector('#svn-speaker');
        if (!spk) return;
        let name = '';
        if (getSettings().showSpeaker !== false && f && f.active && f.cast && f.cast[f.active]) {
            const a = findActorByKey(f.active);
            name = a ? displayActorName(a) : (f.cast[f.active].name || '');
            if (/\{\{\s*user\s*\}\}/i.test(name)) { const pn = String(getCtx().name1 || '').trim(); name = pn || 'Ты'; }
        }
        spk.textContent = name;
        spk.classList.toggle('svn-show', !!name);
    }

    function renderFrame() {
        const ov = player.el; if (!ov || !player.scene) return;
        const frames = player.scene.frames;
        player.frame = Math.max(0, Math.min(player.frame, frames.length - 1));
        const f = frames[player.frame];
        setText(f.text || '');
        updateSpeaker(f);
        ov.querySelector('#svn-progress').textContent = `${player.frame + 1} / ${frames.length}`;
        const fill = ov.querySelector('#svn-prog-fill');
        if (fill) fill.style.width = (frames.length > 1 ? ((player.frame + 1) / frames.length * 100) : 100) + '%';
        const url = frameBgUrl();
        setBackground(url);
        // индикатор кадра: спиннер «генерируется…» / «не сгенерировался — Повторить» (фон держит ближайшую картинку)
        updateBgNote();
        renderSprites();
        applyMoodTint();      // мягкий тинт акцента под настроение сцены
        parallaxNudge();      // лёгкий параллакс спрайтов/фона при смене кадра
        markSeen(player.mesId, player.frame); // отметка «прочитано»
        saveLastRead(player.mesId, player.frame); // запоминаем место чтения для «продолжить»
        scheduleAuto();
        engineOnFrame();
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  ОТМЕТКА «ПРОЧИТАНО» + БЫСТРЫЙ СКИП УЖЕ ВИДЕННОГО               ║
    // ║  Храним per-chat { mesId: максимальный показанный кадр }.       ║
    // ╚════════════════════════════════════════════════════════════════╝
    function seenStore() {
        const s = getSettings();
        if (!s.seenState || typeof s.seenState !== 'object') s.seenState = {};
        const k = stateKey();
        if (!s.seenState[k] || typeof s.seenState[k] !== 'object') s.seenState[k] = {};
        return s.seenState[k];
    }
    function markSeen(mesId, frame) {
        if (mesId == null || frame == null) return;
        const st = seenStore(); const prev = st[mesId];
        if (typeof prev !== 'number' || frame > prev) { st[mesId] = frame; saveSettings(); }
    }
    // ── место чтения: «продолжить с того же места» (per-chat) ──────────
    function lastReadStore() {
        const s = getSettings();
        if (!s.lastRead || typeof s.lastRead !== 'object') s.lastRead = {};
        return s.lastRead;
    }
    function saveLastRead(mesId, frame) {
        if (mesId == null || frame == null) return;
        const st = lastReadStore(); const k = stateKey(); const prev = st[k];
        if (prev && prev.mesId === mesId && prev.frame === frame) return; // не дёргаем save зря
        st[k] = { mesId, frame }; saveSettings();
    }
    function isSeen(mesId, frame) {
        const v = seenStore()[mesId];
        return typeof v === 'number' && frame <= v;
    }
    // первый непрочитанный кадр в указанной сцене (или -1, если вся прочитана)
    function firstUnseenFrame(mesId, scene) {
        if (!scene) return -1;
        const seen = seenStore()[mesId];
        const max = (typeof seen === 'number') ? seen : -1;
        return (max < scene.frames.length - 1) ? (max + 1) : -1;
    }
    // быстрый скип: прыгаем к первому непрочитанному кадру (в этой сцене → дальше по сценам)
    function skipSeen() {
        if (!player.scene) return;
        const here = firstUnseenFrame(player.mesId, player.scene);
        if (here >= 0 && here > player.frame) { completeText(); player.frame = here; renderFrame(); return; }
        // в текущей сцене всё прочитано — ищем ближайшую сцену впереди с непрочитанным
        const ids = vnMessageIds();
        const cur = ids.indexOf(player.mesId);
        for (let i = cur + 1; i < ids.length; i++) {
            const id = ids[i];
            const sc = parseSceneCached(id);
            if (!sc) continue;
            const fr = firstUnseenFrame(id, sc);
            if (fr >= 0 || (seenStore()[id] == null)) {
                const wasAuto = player.autoPlay;
                openPlayer(id);
                player.frame = Math.max(0, fr < 0 ? 0 : fr);
                renderFrame();
                player.autoPlay = wasAuto; updateAutoBtn(); scheduleAuto();
                return;
            }
        }
        // непрочитанного больше нет — на последний кадр текущей сцены
        if (player.frame < player.scene.frames.length - 1) { completeText(); player.frame = player.scene.frames.length - 1; renderFrame(); }
        toastr && toastr.info('Дальше непрочитанного нет', 'Визуальная новелла');
    }

    // ── авто-тинт акцента под настроение сцены ────────────────────────
    // палитра настроений → представительный цвет акцента (--svn-accent)
    const MOOD_TINTS = [
        { re: /(агресс|гнев|ярост|злост|злоб|враждеб|ссор|конфликт|бой|драк|напряж|опасн|угроз|жесток|бешен|ненавист|tense|anger|angry|hostile|rage|fight|aggress)/i, color: '#ff6a5a' },
        { re: /(страх|ужас|паник|тревог|жутк|зловещ|пугающ|боязн|fear|scary|dread|panic|anxious|terror)/i, color: '#e0653e' },
        { re: /(нежн|роман|любов|ласк|тепл|флирт|влюбл|страст|интим|уют|sweet|romantic|love|tender|affection|warm|flirt|passion)/i, color: '#ff8fb6' },
        { re: /(радост|весел|счаст|восторг|празд|игрив|задор|бодр|joy|happy|cheer|fun|playful|excited)/i, color: '#ffcf5c' },
        { re: /(спокой|умиротвор|безмятеж|тих|мир|расслаб|нежащ|ясн|calm|peace|serene|relax|quiet|gentle)/i, color: '#67d6c0' },
        { re: /(груст|печал|тоск|меланхол|уныл|горе|слёз|слез|одинок|sad|melanchol|sorrow|gloom|lonely|tear)/i, color: '#7ba6e8' },
        { re: /(мрач|тайн|загадоч|темн|сумрач|готич|мистич|потуст|dark|mystery|gloomy|eerie|occult|gothic)/i, color: '#b08bff' },
    ];
    function moodTintColor(mood) {
        const m = String(mood || '').toLowerCase();
        if (!m) return null;
        for (const t of MOOD_TINTS) if (t.re.test(m)) return t.color;
        return null;
    }
    // настроение текущей сцены: сперва липкое состояние модуля «scene», иначе прямо из <vn-status>
    function currentSceneMood() {
        try {
            const st = getModState('scene');
            if (st && st.mood) return st.mood;
        } catch (e) { /* ignore */ }
        try { return parseVnStatus(((getCtx().chat || [])[player.mesId] || {}).mes || '').mood || ''; }
        catch (e) { return ''; }
    }
    function applyMoodTint() {
        const ov = player.el; if (!ov) return;
        const base = getSettings().accentColor || '#78aaff'; // пользовательский акцент = база, mood-тинт его перекрывает
        const color = (getSettings().moodTint !== false) ? moodTintColor(currentSceneMood()) : null;
        ov.style.setProperty('--svn-accent', color || base);
    }
    // hex → rgb; для фона окна (panelColor + матовость glass)
    function svnHexRgb(hex) {
        hex = String(hex || '').trim().replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const n = parseInt(hex || '141416', 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    // формат-/текст-цвета (НЕ акцент — он ставится в applyMoodTint, т.к. может тинтоваться настроением)
    function applyFmtVars(el, s) {
        if (!el) return;
        el.style.setProperty('--svn-speech', s.speechColor || '#78aaff');
        el.style.setProperty('--svn-emph', s.italicColor || '#d7d8de');
        el.style.setProperty('--svn-strong', s.boldColor || '#ffffff');
        el.style.setProperty('--svn-text-color', s.textColor || '#f4f4f6');
    }
    // применить тему ко ВСЕМ поверхностям: плеер (акцент+формат+фон окна) и панель настроек (акцент+формат)
    function applyTheme() {
        const s = getSettings();
        const ov = player.el;
        if (ov) {
            applyFmtVars(ov, s);
            applyMoodTint();
            const dlg = ov.querySelector('#svn-dialog');
            const [r, g, b] = svnHexRgb(s.panelColor || '#141416');
            if (dlg) dlg.style.background = `rgba(${r},${g},${b},${s.glass})`;
        }
        const cfg = document.getElementById('svn-cfg'); // панель настроек живёт вне overlay — задаём вары явно
        if (cfg) { cfg.style.setProperty('--svn-accent', s.accentColor || '#78aaff'); applyFmtVars(cfg, s); }
        applyGlobalTheme(); // карточки-лаунчеры в ленте чата живут вне плеера — тянем тему на них
    }
    // тема на ВСЮ страницу (карточки VN в ленте чата): акцент + шрифт на document.body,
    // отсюда `var(--svn-accent)`/`var(--svn-font)` карточек наследуют выбранный вид.
    // Плеер (#svn-overlay) и панель (#svn-cfg) задают свой --svn-accent сами → их это не трогает.
    function applyGlobalTheme() {
        const s = getSettings();
        const b = document.body; if (!b) return;
        b.style.setProperty('--svn-accent', s.accentColor || '#78aaff');
        const font = fontStackOf(s);
        if (!font || font === 'inherit') b.style.removeProperty('--svn-card-font'); else b.style.setProperty('--svn-card-font', font);
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  ТЕМЫ-ПРЕСЕТЫ: снимок / применение / CRUD / экспорт-импорт      ║
    // ╚════════════════════════════════════════════════════════════════╝
    function getPresets() { const s = getSettings(); if (!Array.isArray(s.themePresets)) s.themePresets = []; return s.themePresets; }
    // снять текущий «вид» в объект (THEME_KEYS)
    function snapshotTheme() {
        const s = getSettings(); const o = {};
        for (const k of THEME_KEYS) o[k] = structuredClone(s[k] != null ? s[k] : DEFAULTS[k]);
        return o;
    }
    // применить набор значений вида: в настройки → сохранить → перерисовать всё
    function applyThemeVals(vals, themeId) {
        const s = getSettings();
        for (const k of Object.keys(vals || {})) if (THEME_KEYS.includes(k)) s[k] = structuredClone(vals[k]);
        s.activeTheme = themeId || '';
        saveSettings();
        if (player.open) { applyVisuals(); renderFrame(); }
        applyTheme();
        for (const t of [document.getElementById('svn-cfg'), player.el && player.el.querySelector('#svn-settings')]) {
            if (t) { try { fillSettingSelects(t); } catch (e) { /* ignore */ } }
        }
        refreshThemeUI();
    }
    function applyBuiltinTheme(id) {
        const t = BUILTIN_THEMES.find(x => x.id === id); if (!t) return;
        applyThemeVals({ ...themeDefaults(), ...t.vals }, 'b:' + id);
    }
    function applyUserPreset(id) { const p = getPresets().find(x => x.id === id); if (p) applyThemeVals(p.vals, id); }
    function resetLook() { applyThemeVals(themeDefaults(), ''); }
    function saveCurrentAsPreset(name) {
        const nm = String(name || '').trim() || ('Тема ' + (getPresets().length + 1));
        const preset = { id: newId(), name: nm.slice(0, 60), vals: snapshotTheme() };
        getPresets().push(preset);
        getSettings().activeTheme = preset.id;
        saveSettings(); refreshThemeUI();
        return preset;
    }
    function updatePreset(id) { const p = getPresets().find(x => x.id === id); if (!p) return; p.vals = snapshotTheme(); getSettings().activeTheme = id; saveSettings(); refreshThemeUI(); }
    function renamePreset(id, name) { const p = getPresets().find(x => x.id === id); if (!p) return; const nm = String(name || '').trim(); if (nm) { p.name = nm.slice(0, 60); saveSettings(); refreshThemeUI(); } }
    function deletePreset(id) {
        const arr = getPresets(); const i = arr.findIndex(x => x.id === id); if (i < 0) return;
        arr.splice(i, 1);
        const s = getSettings(); if (s.activeTheme === id) s.activeTheme = '';
        saveSettings(); refreshThemeUI();
    }
    // экспорт/импорт
    function svnSafeFile(name) { return (String(name || '').replace(/[^\wЀ-ӿ -]+/g, '').trim().replace(/\s+/g, '_') || 'theme').slice(0, 40); }
    function downloadJson(filename, obj) {
        try {
            const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = filename;
            document.body.appendChild(a); a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 600);
        } catch (e) { if (window.toastr) toastr.error('Не вышло сохранить файл', 'Визуальная новелла'); }
    }
    function exportPreset(id) { const p = getPresets().find(x => x.id === id); if (p) downloadJson(svnSafeFile(p.name) + '.svntheme.json', { svnTheme: 1, name: p.name, vals: p.vals }); }
    function exportCurrent() { downloadJson('svn-current.svntheme.json', { svnTheme: 1, name: 'Текущий вид', vals: snapshotTheme() }); }
    function importPresetsFromFile(file) {
        if (!file) return;
        const fr = new FileReader();
        fr.onload = () => {
            try {
                const data = JSON.parse(fr.result);
                const items = Array.isArray(data) ? data : [data];
                let added = 0;
                for (const it of items) {
                    const vals = it && it.vals;
                    if (!vals || typeof vals !== 'object') continue;
                    const clean = {};
                    for (const k of THEME_KEYS) if (k in vals) clean[k] = vals[k];
                    if (!Object.keys(clean).length) continue;
                    getPresets().push({ id: newId(), name: String(it.name || 'Импорт').slice(0, 60), vals: clean });
                    added++;
                }
                saveSettings(); refreshThemeUI();
                if (window.toastr) (added ? toastr.success('Импортировано тем: ' + added, 'Визуальная новелла') : toastr.warning('В файле нет тем VN', 'Визуальная новелла'));
            } catch (e) { if (window.toastr) toastr.error('Файл не похож на тему VN', 'Визуальная новелла'); }
        };
        fr.readAsText(file);
    }
    function pickImportFile() {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
        inp.addEventListener('change', () => { if (inp.files && inp.files[0]) importPresetsFromFile(inp.files[0]); });
        inp.click();
    }
    function pickBgFile() {
        const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
        inp.addEventListener('change', async () => {
            if (!(inp.files && inp.files[0])) return;
            try {
                await setCustomBgFromFile(inp.files[0]);
                const s = getSettings(); if (s.bgMode !== 'custom') s.bgMode = 'custom'; saveSettings();
                for (const t of [document.getElementById('svn-cfg'), player.el && player.el.querySelector('#svn-settings')]) { const sel = t && t.querySelector('[data-set="bgMode"]'); if (sel) sel.value = 'custom'; }
                if (player.open) { applyVisuals(); renderFrame(); }
                refreshThemeUI();
                if (window.toastr) toastr.success('Фон загружен — режим фона «Свой»', 'Визуальная новелла');
            } catch (e) { if (window.toastr) toastr.error('Не вышло загрузить картинку', 'Визуальная новелла'); }
        });
        inp.click();
    }
    function clearCustomBgAndRefresh() { clearCustomBg().then(() => { if (player.open) { applyVisuals(); renderFrame(); } refreshThemeUI(); }); }
    // перерисовать UI тем в обоих местах (панель настроек + компактный селект в плеере)
    function refreshThemeUI() {
        const cfg = document.getElementById('svn-cfg');
        if (cfg) { const host = cfg.querySelector('#svn-theme-host'); if (host) renderPresetUI(host); }
        const ovSel = player.el && player.el.querySelector('[data-theme-pick]');
        if (ovSel) fillThemeSelect(ovSel);
    }
    function fillThemeSelect(sel) {
        const s = getSettings(); const active = s.activeTheme || '';
        let h = '<option value="">— тема —</option>';
        h += '<optgroup label="Готовые">' + BUILTIN_THEMES.map(t => `<option value="b:${t.id}"${active === 'b:' + t.id ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('') + '</optgroup>';
        const presets = getPresets();
        if (presets.length) h += '<optgroup label="Мои">' + presets.map(p => `<option value="${p.id}"${active === p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('') + '</optgroup>';
        sel.innerHTML = h;
    }
    // полный блок управления темами в панели #svn-cfg
    function renderPresetUI(host) {
        const s = getSettings();
        const active = s.activeTheme || '';
        const sw = BUILTIN_THEMES.map(t => {
            const v = { ...themeDefaults(), ...t.vals };
            const on = active === ('b:' + t.id) ? ' svn-on' : '';
            return `<button type="button" class="svn-theme-swatch${on}" data-builtin="${t.id}" title="${escapeHtml(t.name)}">
                <span class="svn-theme-sw-pv" style="background:${escapeHtml(v.panelColor || '#141416')}">
                    <span class="svn-theme-sw-dot" style="background:${escapeHtml(v.accentColor || '#78aaff')}"></span>
                    <span class="svn-theme-sw-box" style="background:${escapeHtml(v.speechColor || v.accentColor || '#78aaff')}"></span>
                </span>
                <span class="svn-theme-sw-name">${escapeHtml(t.name)}</span></button>`;
        }).join('');
        const presets = getPresets();
        const list = presets.length ? presets.map(p => {
            const on = active === p.id ? ' svn-on' : '';
            return `<div class="svn-preset-row${on}" data-pid="${p.id}">
                <span class="svn-preset-name" data-act="apply" title="Применить">${escapeHtml(p.name)}</span>
                <button type="button" class="svn-ib" data-act="update" title="Перезаписать текущим видом"><i class="fa-solid fa-arrows-rotate"></i></button>
                <button type="button" class="svn-ib" data-act="rename" title="Переименовать"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="svn-ib" data-act="export" title="Экспорт в файл"><i class="fa-solid fa-download"></i></button>
                <button type="button" class="svn-ib" data-act="delete" title="Удалить"><i class="fa-solid fa-trash"></i></button>
            </div>`;
        }).join('') : `<div class="svn-preset-empty">Пока нет своих тем. Настрой вид ниже и нажми «Сохранить как тему».</div>`;
        const bgUrl = (s.hasCustomBg && customBgUrl()) ? customBgUrl() : '';
        host.innerHTML = `
            <div class="svn-cfg-h">Готовые темы</div>
            <div class="svn-theme-row">${sw}</div>
            <div class="svn-cfg-h">Мои темы</div>
            <div class="svn-preset-list">${list}</div>
            <div class="svn-preset-bar">
                <button type="button" class="svn-set-btn" data-theme="save"><i class="fa-solid fa-floppy-disk"></i> Сохранить как тему</button>
                <button type="button" class="svn-set-btn" data-theme="import"><i class="fa-solid fa-upload"></i> Импорт темы</button>
                <button type="button" class="svn-set-btn" data-theme="exportcur"><i class="fa-solid fa-download"></i> Экспорт текущего</button>
                <button type="button" class="svn-set-btn" data-theme="reset"><i class="fa-solid fa-rotate-left"></i> Сбросить вид</button>
            </div>
            <div class="svn-cfg-h">Свой фон сцены</div>
            <small class="svn-cfg-note">Загрузи картинку — станет фоном при режиме фона «Свой». Хранится локально (IndexedDB).</small>
            <div class="svn-bg-up">
                <div class="svn-bg-up-thumb"${bgUrl ? ` style="background-image:url('${cssUrl(bgUrl)}')"` : ''}>${bgUrl ? '' : '<i class="fa-solid fa-image"></i>'}</div>
                <div class="svn-bg-up-btns">
                    <button type="button" class="svn-set-btn" data-theme="bgupload"><i class="fa-solid fa-upload"></i> Загрузить фон…</button>
                    <button type="button" class="svn-set-btn" data-theme="bgclear"${s.hasCustomBg ? '' : ' disabled'}><i class="fa-solid fa-trash"></i> Убрать фон</button>
                </div>
            </div>`;
        wirePresetUI(host);
    }
    function wirePresetUI(host) {
        host.querySelectorAll('[data-builtin]').forEach(b => b.addEventListener('click', () => applyBuiltinTheme(b.dataset.builtin)));
        host.querySelectorAll('.svn-preset-row').forEach(row => {
            const id = row.dataset.pid;
            row.addEventListener('click', (e) => {
                const act = e.target.closest('[data-act]'); if (!act) return;
                const a = act.dataset.act;
                if (a === 'apply') applyUserPreset(id);
                else if (a === 'update') { updatePreset(id); if (window.toastr) toastr.success('Тема обновлена', 'Визуальная новелла'); }
                else if (a === 'rename') { const p = getPresets().find(x => x.id === id); const nm = window.prompt('Новое имя темы:', p ? p.name : ''); if (nm != null) renamePreset(id, nm); }
                else if (a === 'export') exportPreset(id);
                else if (a === 'delete') { if (window.confirm('Удалить тему?')) deletePreset(id); }
            });
        });
        const tb = host.querySelector('.svn-preset-bar');
        if (tb) tb.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-theme]'); if (!btn) return;
            const a = btn.dataset.theme;
            if (a === 'save') { const nm = window.prompt('Имя темы:', 'Моя тема'); if (nm != null) { saveCurrentAsPreset(nm); if (window.toastr) toastr.success('Тема сохранена', 'Визуальная новелла'); } }
            else if (a === 'reset') { if (window.confirm('Сбросить вид к стандарту?')) resetLook(); }
            else if (a === 'exportcur') exportCurrent();
            else if (a === 'import') pickImportFile();
        });
        const bgbar = host.querySelector('.svn-bg-up');
        if (bgbar) bgbar.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-theme]'); if (!btn) return;
            if (btn.dataset.theme === 'bgupload') pickBgFile();
            else if (btn.dataset.theme === 'bgclear') clearCustomBgAndRefresh();
        });
    }

    // ── лёгкий параллакс при смене кадра (расширение Ken Burns) ────────
    function parallaxNudge() {
        const ov = player.el; if (!ov) return;
        const s = getSettings();
        const on = s.parallax !== false && s.motion !== 'none';
        const sprites = ov.querySelector('#svn-sprites');
        if (sprites) sprites.style.transform = on ? `translateX(${((player.frame % 2) ? 1 : -1) * 9}px)` : '';
        // фон «наезжает» по кадрам только в обычном режиме (в «кино» этим уже занят Ken Burns)
        const layers = ov.querySelectorAll('.svn-bg-layer');
        const cur = layers[_bgActive];
        if (cur) {
            if (on && s.motion === 'fade') {
                const z = (player.frame % 2) ? 1.055 : 1.02;
                const dx = ((player.frame % 2) ? -1 : 1) * 0.8;
                cur.style.transform = `scale(${z}) translateX(${dx}%)`;
            } else if (s.motion !== 'cinematic') {
                cur.style.transform = '';
            }
        }
    }

    function next() {
        if (!player.scene) return;
        if (player.typing) { completeText(); return; }
        if (player.frame < player.scene.frames.length - 1) { player.frame++; renderFrame(); }
        else { gotoTurn(1, true); }
    }
    function prev() {
        if (!player.scene) return;
        if (player.typing) completeText();
        if (player.frame > 0) { player.frame--; renderFrame(); }
        else gotoTurn(-1);
    }
    function gotoTurn(dir, silent) {
        const ids = vnMessageIds();
        const cur = ids.indexOf(player.mesId);
        const target = ids[cur + dir];
        if (target === undefined) { if (!silent) toastr && toastr.info(dir > 0 ? 'Это последняя сцена' : 'Это первая сцена', 'Визуальная новелла'); return; }
        const wasAuto = player.autoPlay;
        openPlayer(target);
        player.autoPlay = wasAuto; updateAutoBtn(); scheduleAuto();
    }

    function toggleSettings() {
        const set = player.el.querySelector('#svn-settings');
        player.el.querySelector('#svn-cast-panel').classList.remove('svn-show');
        set.classList.toggle('svn-show');
    }
    function toggleCastPanel() {
        const cp = player.el.querySelector('#svn-cast-panel');
        player.el.querySelector('#svn-settings').classList.remove('svn-show');
        const show = !cp.classList.contains('svn-show');
        cp.classList.toggle('svn-show', show);
        if (show) loadSpriteCache().then(() => { renderCastPanel(); renderSprites(); });
        renderCastPanel();
    }
    function toggleDialog() {
        player.dialogHidden = !player.dialogHidden;
        player.el.querySelector('#svn-dialog').classList.toggle('svn-dialog-hidden', player.dialogHidden);
        const icon = player.el.querySelector('[data-act="hide"] i');
        if (icon) icon.className = player.dialogHidden ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye';
        updateContinue();
    }

    // ── автоплей ──────────────────────────────────────────────────────
    function updateAutoBtn() {
        const btn = player.el && player.el.querySelector('[data-act="auto"]');
        if (!btn) return;
        btn.classList.toggle('svn-ib-active', player.autoPlay);
        btn.querySelector('i').className = player.autoPlay ? 'fa-solid fa-pause' : 'fa-solid fa-play';
    }
    function toggleAuto() { player.autoPlay = !player.autoPlay; updateAutoBtn(); scheduleAuto(); }
    function scheduleAuto() {
        clearTimeout(_autoTimer);
        if (!player.autoPlay || !player.open) return;
        const len = (player.fullText || '').length;
        const speed = Math.max(8, getSettings().typeSpeed || 26);
        const mul = ({ slow: 1.8, normal: 1, fast: 0.5 })[getSettings().autoSpeed || 'normal'] || 1;
        const delay = ((getSettings().typewriter ? len * speed : 0) + 1400 + len * 22) * mul;
        _autoTimer = setTimeout(() => {
            if (!player.autoPlay) return;
            if (player.frame < player.scene.frames.length - 1) { completeText(); player.frame++; renderFrame(); }
            else { player.autoPlay = false; updateAutoBtn(); }
        }, delay);
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  СПРАЙТЫ НА СЦЕНЕ                                               ║
    // ╚════════════════════════════════════════════════════════════════╝
    const POS_ORDER = ['center', 'left', 'right', 'farleft', 'farright'];

    function getLiveSpriteSrc() {
        const img = document.querySelector('#expression-image, img.expression');
        if (!img) return null;
        const src = img.getAttribute('src') || img.src || '';
        if (!src || src === window.location.href || /\/img\/(none|default)\b/i.test(src)) return null;
        return src;
    }

    // итоговый состав сцены для кадра: живой актёр + авто-каст ИИ + ручной оверрайд
    function buildEffectiveCast(frame) {
        const s = getSettings();
        const out = {};
        if (s.spritePos && s.spritePos !== 'off') out['__live__'] = { live: true, pos: s.spritePos, name: '(текущий персонаж)', emo: '' };
        if (s.spriteAuto !== false && frame && frame.cast) for (const k in frame.cast) out[k] = { name: frame.cast[k].name, pos: frame.cast[k].pos, emo: frame.cast[k].emo };
        // авто-эмоция {{char}} из <vn-status> (модуль «emotion»): показываем главного героя
        // с заданной эмоцией без отдельного тега <sprite> — но не перебивая явный <sprite>/ручное
        if (moduleEnabled('emotion') && _statusEmotion && !player.manualStage['__char__']) {
            const a = findActorByKey('__char__');
            if (a && actorEmotions(a).length) {
                if (out['__char__']) { if (!out['__char__'].emo) out['__char__'].emo = _statusEmotion; }
                else out['__char__'] = { name: displayActorName(a), pos: a.pos || 'center', emo: _statusEmotion };
            }
        }
        for (const k in player.manualStage) {
            const mv = player.manualStage[k];
            if (!mv || mv.pos === 'off') { delete out[k]; continue; }
            out[k] = { name: mv.name, pos: mv.pos, emo: mv.emo, live: mv.live };
        }
        return out;
    }
    function entrySprite(key, entry) {
        if (key === '__live__' || entry.live) return { url: getLiveSpriteSrc(), name: entry.name, live: true };
        const actor = findActorByKey(key) || findActor(entry.name);
        if (!actor) return { url: null, name: entry.name, missing: true };
        return { url: actorSpriteUrl(actor, entry.emo), name: actor.name, missing: !actorEmotions(actor).length };
    }
    function renderSprites() {
        const ov = player.el; if (!ov) return;
        const cont = ov.querySelector('#svn-sprites'); if (!cont) return;
        const s = getSettings();
        const frame = player.scene ? player.scene.frames[player.frame] : null;
        const cast = buildEffectiveCast(frame);
        const keys = Object.keys(cast);
        const activeKey = (s.spriteAuto !== false && frame) ? frame.active : null;
        // раскладка позиций (разводим совпадающие)
        const used = {}, layout = {};
        for (const k of keys) {
            let pos = cast[k].pos || 'center';
            if (POS_ORDER.indexOf(pos) === -1) pos = 'center';
            let p = pos, n = 0;
            while (used[p] && n <= POS_ORDER.length) { n++; p = POS_ORDER[(POS_ORDER.indexOf(pos) + n) % POS_ORDER.length]; }
            used[p] = true; layout[k] = p;
        }
        // существующие img по ключу
        const existing = {};
        Array.from(cont.children).forEach(img => { existing[img.dataset.key] = img; });
        // убрать ушедших
        for (const dk in existing) {
            if (keys.indexOf(dk) === -1) {
                const img = existing[dk]; img.classList.remove('svn-show');
                setTimeout(() => { if (img.parentNode && !img.classList.contains('svn-show')) img.remove(); }, 340);
            }
        }
        const multi = keys.filter(k => k !== '__live__').length > 1;
        for (const k of keys) {
            const sp = entrySprite(k, cast[k]);
            let img = existing[k];
            if (!sp.url) { if (img) img.classList.remove('svn-show'); continue; }
            if (!img) { img = document.createElement('img'); img.className = 'svn-spr'; img.dataset.key = k; img.alt = ''; cont.appendChild(img); }
            if (img.getAttribute('src') !== sp.url) img.setAttribute('src', sp.url);
            img.classList.remove('svn-spr-left', 'svn-spr-center', 'svn-spr-right', 'svn-spr-farleft', 'svn-spr-farright');
            img.classList.add('svn-spr-' + layout[k]);
            const dim = s.speakerFocus !== false && multi && activeKey && k !== activeKey && k !== '__live__';
            img.classList.toggle('svn-spr-dim', !!dim);
            requestAnimationFrame(() => img.classList.add('svn-show'));
        }
        const btn = ov.querySelector('[data-act="cast"]');
        if (btn) btn.classList.toggle('svn-ib-active', keys.length > 0);
    }
    function ensureSpriteObserver() {
        if (_spriteObs) return;
        const holder = document.getElementById('expression-holder') || document.getElementById('expression-wrapper') || document.getElementById('expression-image');
        if (!holder) return;
        _spriteObs = new MutationObserver(() => { if (player.open && isSpriteOn()) renderSprites(); });
        _spriteObs.observe(holder, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
    }

    // ── панель ручного управления составом ────────────────────────────
    function castRowHtml(key, label, emotions, pos, emo, on, isLive) {
        const posOpts = ['left', 'center', 'right', 'farleft', 'farright'].map(p =>
            `<option value="${p}"${p === pos ? ' selected' : ''}>${({ left: 'слева', center: 'центр', right: 'справа', farleft: 'край◀', farright: 'край▶' })[p]}</option>`).join('');
        let emoSel = '';
        if (emotions && emotions.length) {
            const o = emotions.map(e => `<option value="${escapeHtml(e)}"${e === emo ? ' selected' : ''}>${escapeHtml(e)}</option>`).join('');
            emoSel = `<select class="svn-cast-emo" data-castkey="${escapeHtml(key)}">${o}</select>`;
        } else if (!isLive) {
            emoSel = `<span class="svn-cast-noimg">нет картинок</span>`;
        }
        return `<div class="svn-cast-row${on ? ' svn-on' : ''}" data-key="${escapeHtml(key)}"${isLive ? ' data-live="1"' : ''}>
  <label class="svn-cast-tgl"><input type="checkbox" class="svn-cast-vis" data-castkey="${escapeHtml(key)}"${on ? ' checked' : ''}><span class="svn-cast-name">${escapeHtml(label)}</span></label>
  <div class="svn-cast-ctl">
    <select class="svn-cast-pos" data-castkey="${escapeHtml(key)}">${posOpts}</select>
    ${emoSel}
  </div>
</div>`;
    }
    function renderCastPanel() {
        const ov = player.el; if (!ov) return;
        const list = ov.querySelector('#svn-cast-list'); if (!list) return;
        const s = getSettings();
        ov.querySelector('[data-castset="spriteAuto"]').checked = s.spriteAuto !== false;
        ov.querySelector('[data-castset="speakerFocus"]').checked = s.speakerFocus !== false;
        const eff = buildEffectiveCast(player.scene ? player.scene.frames[player.frame] : null);
        const rows = [];
        // живой актёр (Character Expressions)
        rows.push(castRowHtml('__live__', '(текущий · Expressions)', null, s.spritePos !== 'off' ? s.spritePos : 'center', '', s.spritePos !== 'off', true));
        for (const a of getCast()) {
            const key = actorKeyOf(a);
            const e = eff[key];
            rows.push(castRowHtml(key, a.name, actorEmotions(a), (e && e.pos) || a.pos || 'center', (e && e.emo) || a.def || '', !!e, false));
        }
        if (!getCast().length) rows.push('<div class="svn-cast-empty">Нет загруженных персонажей. Открой «Менеджер спрайтов…», добавь персонажа и загрузи картинки эмоций.</div>');
        list.innerHTML = rows.join('');
        // провязка
        list.querySelectorAll('.svn-cast-vis').forEach(el => el.addEventListener('change', onCastVisChange));
        list.querySelectorAll('.svn-cast-pos').forEach(el => el.addEventListener('change', onCastPosEmoChange));
        list.querySelectorAll('.svn-cast-emo').forEach(el => el.addEventListener('change', onCastPosEmoChange));
    }
    function rowState(row) {
        if (!row) return { pos: 'center', emo: '' };
        const posEl = row.querySelector('.svn-cast-pos'), emoEl = row.querySelector('.svn-cast-emo');
        return { pos: posEl ? posEl.value : 'center', emo: emoEl ? emoEl.value : '' };
    }
    function onCastVisChange(e) {
        const row = e.target.closest('.svn-cast-row');
        const key = e.target.dataset.castkey;
        const on = e.target.checked;
        const st = rowState(row);
        if (key === '__live__') {
            getSettings().spritePos = on ? (st.pos || 'center') : 'off';
            saveSettings();
        } else {
            const a = findActorByKey(key);
            if (!on) player.manualStage[key] = { name: a ? a.name : key, pos: 'off' };
            else player.manualStage[key] = { name: a ? a.name : key, pos: st.pos || (a && a.pos) || 'center', emo: st.emo || (a && a.def) || '' };
        }
        renderSprites(); renderCastPanel();
    }
    function onCastPosEmoChange(e) {
        const row = e.target.closest('.svn-cast-row');
        const key = (row && row.dataset.key) || e.target.dataset.castkey;
        const st = rowState(row);
        if (key === '__live__') {
            if (getSettings().spritePos !== 'off') { getSettings().spritePos = st.pos; saveSettings(); }
        } else {
            const a = findActorByKey(key);
            player.manualStage[key] = { name: a ? a.name : key, pos: st.pos, emo: st.emo };
        }
        renderSprites(); renderCastPanel();
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  МЕНЕДЖЕР СПРАЙТОВ (загрузка картинок)                          ║
    // ╚════════════════════════════════════════════════════════════════╝
    function openCastManager(standalone) {
        buildOverlay();
        player.mgrStandalone = !!standalone && !player.open;
        if (player.mgrStandalone) {
            player.el.classList.add('svn-show');
            document.body.classList.add('svn-lock');
            document.addEventListener('keydown', onKeydown, true);
        }
        player.el.querySelector('#svn-cast-mgr').classList.add('svn-show');
        renderCastManager();
        loadSpriteCache().then(renderCastManager);
    }
    function closeCastManager() {
        if (!player.el) return;
        player.el.querySelector('#svn-cast-mgr').classList.remove('svn-show');
        updateInjection();
        updateCastCount();
        if (player.mgrStandalone && !player.open) {
            player.el.classList.remove('svn-show');
            document.body.classList.remove('svn-lock');
            document.removeEventListener('keydown', onKeydown, true);
        }
        player.mgrStandalone = false;
        if (player.open) { renderSprites(); renderCastPanel(); }
        // если в менеджер зашли из обычного меню настроек — вернёмся туда, на вкладку «Спрайты»
        if (player.mgrReturnToCfg) { player.mgrReturnToCfg = false; if (!player.open) openSettingsPanel('spr'); }
    }
    function renderCastManager() {
        const ov = player.el; if (!ov) return;
        const body = ov.querySelector('#svn-mgr-body'); if (!body) return;
        const cast = getCast();
        if (!cast.length) {
            body.innerHTML = `<div class="svn-mgr-empty"><i class="fa-solid fa-masks-theater"></i><p>Пока нет персонажей.<br>Нажми «Персонаж» вверху или используй быстрые кнопки, потом загрузи картинки эмоций.</p></div>`;
            return;
        }
        body.innerHTML = cast.map(actorCardHtml).join('');
    }
    function actorCardHtml(a) {
        const emos = Object.keys(a.expr || {});
        const tiles = emos.map(emo => {
            const url = spriteCache.get(a.expr[emo]);
            const isDef = a.def === emo;
            return `<div class="svn-expr${isDef ? ' svn-expr-def' : ''}" data-actor="${escapeHtml(a.id)}" data-emo="${escapeHtml(emo)}">
  <div class="svn-expr-thumb" style="${url ? `background-image:url('${cssUrl(url)}')` : ''}" data-act="replace" title="Заменить картинку">${url ? '' : '<i class="fa-solid fa-image"></i>'}</div>
  <div class="svn-expr-name" title="${escapeHtml(emo)}">${escapeHtml(emo)}</div>
  <div class="svn-expr-btns">
    <button class="svn-expr-mini${isDef ? ' on' : ''}" data-act="setdef" title="Сделать эмоцией по умолчанию"><i class="fa-solid fa-star"></i></button>
    <button class="svn-expr-mini" data-act="delexpr" title="Удалить эмоцию"><i class="fa-solid fa-trash"></i></button>
  </div>
</div>`;
        }).join('');
        const emoOpts = EMOTIONS.map(e => `<option value="${e}">${e}</option>`).join('');
        return `<div class="svn-actor" data-actor="${escapeHtml(a.id)}">
  <div class="svn-actor-head">
    <input class="svn-actor-name text_pole" data-act="rename" value="${escapeHtml(a.name)}" placeholder="Имя персонажа">
    <select class="svn-actor-role" data-act="role" title="Роль персонажа">
      <option value="char"${a.role === 'char' ? ' selected' : ''}>персонаж</option>
      <option value="user"${a.role === 'user' ? ' selected' : ''}>игрок</option>
      <option value="npc"${(!a.role || a.role === 'npc') ? ' selected' : ''}>NPC</option>
    </select>
    <select class="svn-actor-pos" data-act="pos" title="Позиция по умолчанию">
      ${['left', 'center', 'right', 'farleft', 'farright'].map(p => `<option value="${p}"${(a.pos || 'center') === p ? ' selected' : ''}>${({ left: 'слева', center: 'центр', right: 'справа', farleft: 'край◀', farright: 'край▶' })[p]}</option>`).join('')}
    </select>
    <button class="svn-ib svn-actor-del" data-act="delactor" title="Удалить персонажа"><i class="fa-solid fa-trash"></i></button>
  </div>
  <div class="svn-expr-grid">
    ${tiles}
    <div class="svn-expr svn-expr-add">
      <label class="svn-expr-thumb svn-expr-addbtn" title="Добавить картинку эмоции"><i class="fa-solid fa-plus"></i><input type="file" accept="image/*" hidden data-act="addfile"></label>
      <select class="svn-expr-emopick" data-act="emopick" title="Эмоция для новой картинки">${emoOpts}</select>
    </div>
  </div>
  <div class="svn-actor-hint"><b>персонаж</b> = {{char}} (главный герой) · <b>игрок</b> = {{user}} · <b>NPC</b> — по имени. Имя должно совпадать с тем, как ИИ зовёт героя в тексте.</div>
</div>`;
    }
    function wireCastManager(ov) {
        const mgr = ov.querySelector('#svn-cast-mgr');
        mgr.querySelector('[data-mgr="close"]').addEventListener('click', closeCastManager);
        mgr.querySelector('[data-mgr="add"]').addEventListener('click', () => addActor(''));
        mgr.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { const p = b.dataset.preset; addActor(p === 'npc' ? '' : p); }));
        const body = ov.querySelector('#svn-mgr-body');
        // делегирование кликов
        body.addEventListener('click', (e) => {
            const actEl = e.target.closest('[data-act]'); if (!actEl) return;
            const act = actEl.dataset.act;
            const actorEl = e.target.closest('.svn-actor'); const actorId = actorEl && actorEl.dataset.actor;
            const exprEl = e.target.closest('.svn-expr'); const emo = exprEl && exprEl.dataset.emo;
            if (act === 'delactor') removeActor(actorId);
            else if (act === 'setdef') setActorDefault(actorId, emo);
            else if (act === 'delexpr') removeExpression(actorId, emo);
            else if (act === 'replace') { const inp = exprEl.querySelector('input[type=file]') || makeReplaceInput(exprEl, actorId, emo); inp.click(); }
        });
        // загрузка файлов (add + replace)
        body.addEventListener('change', (e) => {
            const inp = e.target;
            if (inp.dataset.act === 'addfile' || inp.dataset.act === 'replacefile') {
                const actorEl = inp.closest('.svn-actor'); const actorId = actorEl && actorEl.dataset.actor;
                let emo;
                if (inp.dataset.act === 'addfile') { const pick = actorEl.querySelector('[data-act="emopick"]'); emo = pick ? pick.value : 'neutral'; }
                else emo = inp.dataset.emo;
                const file = inp.files && inp.files[0];
                if (file && actorId) uploadExpression(actorId, emo, file);
                inp.value = '';
            } else if (inp.dataset.act === 'rename') { /* handled on input */ }
            else if (inp.dataset.act === 'pos') {
                const actorEl = inp.closest('.svn-actor'); const a = getCast().find(x => x.id === actorEl.dataset.actor);
                if (a) { a.pos = inp.value; saveSettings(); }
            }
            else if (inp.dataset.act === 'role') {
                const actorEl = inp.closest('.svn-actor'); const a = getCast().find(x => x.id === actorEl.dataset.actor);
                if (a) { a.role = inp.value; saveSettings(); updateInjection(); updateCastCount(); if (player.open) { renderSprites(); renderCastPanel(); } }
            }
        });
        body.addEventListener('input', (e) => {
            if (e.target.dataset.act === 'rename') {
                const actorEl = e.target.closest('.svn-actor'); const a = getCast().find(x => x.id === actorEl.dataset.actor);
                if (a) { a.name = e.target.value; saveSettings(); }
            }
        });
    }
    function makeReplaceInput(exprEl, actorId, emo) {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.hidden = true;
        inp.dataset.act = 'replacefile'; inp.dataset.emo = emo;
        exprEl.appendChild(inp);
        return inp;
    }
    function addActor(name, role) {
        const cast = getCast();
        let nm = name || `Персонаж ${cast.length + 1}`;
        let rl = role || 'npc';
        if (/\{\{\s*user\s*\}\}/i.test(nm)) { rl = 'user'; nm = '{{user}}'; }
        else if (/\{\{\s*char\s*\}\}/i.test(nm)) { rl = 'char'; const cn = String(getCtx().name2 || '').trim(); nm = cn || '{{char}}'; }
        cast.push({ id: newId(), name: nm, role: rl, pos: 'center', def: '', expr: {} });
        saveSettings(); updateInjection(); updateCastCount();
        renderCastManager();
    }
    function removeActor(id) {
        const cast = getCast();
        const a = cast.find(x => x.id === id); if (!a) return;
        if (!confirm(`Удалить персонажа «${a.name}» и все его картинки?`)) return;
        for (const k in (a.expr || {})) { if (a.expr[k]) { idbDel(a.expr[k]); spriteCache.delete(a.expr[k]); } }
        const i = cast.indexOf(a); if (i >= 0) cast.splice(i, 1);
        saveSettings(); updateInjection(); updateCastCount();
        renderCastManager(); if (player.open) { renderSprites(); renderCastPanel(); }
    }
    function setActorDefault(id, emo) {
        const a = getCast().find(x => x.id === id); if (!a) return;
        a.def = emo; saveSettings(); renderCastManager();
        if (player.open) renderSprites();
    }
    function removeExpression(id, emo) {
        const a = getCast().find(x => x.id === id); if (!a || !a.expr[emo]) return;
        const imgId = a.expr[emo];
        idbDel(imgId); spriteCache.delete(imgId);
        delete a.expr[emo];
        if (a.def === emo) a.def = Object.keys(a.expr)[0] || '';
        saveSettings(); updateInjection();
        renderCastManager(); if (player.open) { renderSprites(); renderCastPanel(); }
    }
    async function uploadExpression(id, emo, file) {
        const a = getCast().find(x => x.id === id); if (!a) return;
        try {
            const dataUrl = await processImageFile(file);
            let imgId = a.expr[emo];
            if (!imgId) { imgId = newId(); a.expr[emo] = imgId; }
            if (!a.def) a.def = emo;
            await idbPut(imgId, dataUrl);
            spriteCache.set(imgId, dataUrl);
            saveSettings(); updateInjection(); updateCastCount();
            renderCastManager(); if (player.open) { renderSprites(); renderCastPanel(); }
        } catch (e) {
            toastr && toastr.warning('Не удалось загрузить картинку (нужен файл изображения)', 'Визуальная новелла');
        }
    }

    // ── пикер фонов ST ────────────────────────────────────────────────
    function collectStBackgrounds() {
        const $ = window.jQuery || window.$;
        const els = Array.from(document.querySelectorAll('#bg_menu_content .bg_example, #bg_custom_content .bg_example'));
        const out = [];
        for (const el of els) {
            const file = el.getAttribute('bgfile') || el.getAttribute('title') || '';
            let url = '';
            if ($) { try { url = $(el).data('url') || ''; } catch (e) { /* ignore */ } }
            if (!url && el.getAttribute('custom') !== 'true' && file) url = `url("${'/backgrounds/' + encodeURIComponent(file)}")`;
            if (!url) continue;
            out.push({ file, title: el.getAttribute('title') || file, url });
        }
        return out;
    }
    function openBgPicker() {
        const ov = player.el; if (!ov) return;
        const grid = ov.querySelector('#svn-picker-grid');
        const list = collectStBackgrounds();
        grid.innerHTML = '';
        // текущий фон таверны
        const curUrl = currentStBg();
        if (curUrl) list.unshift({ file: '', title: 'Текущий фон таверны', url: curUrl });
        if (list.length === 0) {
            grid.innerHTML = '<div class="svn-picker-empty">Фоны не найдены. Открой панель «Backgrounds» в SillyTavern хотя бы раз, чтобы список загрузился.</div>';
        } else {
            for (const bg of list) {
                const item = document.createElement('button');
                item.className = 'svn-picker-item';
                item.title = bg.title;
                item.style.backgroundImage = bg.url;
                if (getSettings().stBgUrl === bg.url) item.classList.add('svn-sel');
                item.innerHTML = `<span>${escapeHtml(bg.title)}</span>`;
                item.addEventListener('click', () => {
                    const s = getSettings();
                    s.stBgUrl = bg.url; s.bgMode = 'st'; saveSettings();
                    const sel = ov.querySelector('[data-set="bgMode"]'); if (sel) sel.value = 'st';
                    syncPickBtn(ov);
                    closeBgPicker(); applyVisuals(); renderFrame();
                });
                grid.appendChild(item);
            }
        }
        ov.querySelector('#svn-picker').classList.add('svn-show');
    }
    function closeBgPicker() { player.el && player.el.querySelector('#svn-picker').classList.remove('svn-show'); }

    // ── refresh / regen / save / send ─────────────────────────────────
    function refreshImages() {
        if (!player.open) return;
        if (getSettings().bgMode !== 'generated') { const note = player.el.querySelector('#svn-bg-note'); if (note) note.classList.remove('svn-show', 'svn-note-fail'); return; }
        const url = bestImageUrl();
        if (url) {
            const layers = player.el.querySelectorAll('.svn-bg-layer');
            const cur = layers[_bgActive];
            if ((cur.dataset.url || '') !== url) setBackground(url);
        }
        // индикатор «генерируется…» / «не сгенерировался — Повторить» (фон при этом держит ближайшую картинку)
        updateBgNote();
    }
    function regenCurrent() {
        if (!player.scene) return;
        const f = player.scene.frames[player.frame];
        if (!f || f.imageIndex < 0) { toastr && toastr.info('У этого кадра нет картинки', 'Визуальная новелла'); return; }
        const mes = getMesEl(player.mesId); if (!mes) return;
        const k = f.imageIndex;
        // 1) sillyimages 1.x: кнопка с data-tag-index
        let btn = mes.querySelector(`.iig-regen-single-btn[data-tag-index="${k}"]`);
        // 2) megarakk / sillyimages 2.0: угловая кнопка .iig-img-regen у K-й картинки
        if (!btn) {
            const media = Array.from(mes.querySelectorAll('img[data-iig-instruction], video[data-iig-instruction]'));
            const host = media[k] && media[k].closest('.iig-img-host');
            btn = (host && (host.querySelector('.iig-img-regen') || host.querySelector('.iig-img-retry')))
                || mes.querySelectorAll('.iig-img-regen, .iig-img-retry')[k] || null;
        }
        if (btn) {
            btn.click();
            toastr && toastr.info('Перегенерация кадра…', 'Визуальная новелла');
            // сброс таймера зависания + сразу спиннер (а не залипшее «не сгенерировался»)
            player.genFrame = -1; player.genSince = Date.now();
            if (getSettings().bgMode === 'generated') {
                const note = player.el.querySelector('#svn-bg-note');
                if (note) { note.classList.remove('svn-note-fail'); note.innerHTML = `<span class="svn-spin"></span><span>кадр генерируется…</span>`; note.classList.add('svn-show'); }
            }
            scheduleCardRefresh(player.mesId);
        } else toastr && toastr.info('Картинка ещё не готова или расширение картинок не активно', 'Визуальная новелла');
    }
    async function saveCurrent() {
        const layers = player.el.querySelectorAll('.svn-bg-layer');
        let url = layers[_bgActive].dataset.url || '';
        if (isCssUrlString(url)) { const m = url.match(/url\(["']?([^"')]+)["']?\)/i); url = m ? m[1] : ''; }
        if (!url) { toastr && toastr.info('Нет картинки для сохранения', 'Визуальная новелла'); return; }
        try {
            const blob = await (await fetch(url)).blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob); a.download = `vn-${player.mesId}-${player.frame}.png`; a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        } catch (e) { const a = document.createElement('a'); a.href = url; a.download = `vn-${player.mesId}.png`; a.target = '_blank'; a.click(); }
    }
    function sendText(text) {
        text = String(text || '').trim(); if (!text) return false;
        const ta = document.getElementById('send_textarea'), btn = document.getElementById('send_but');
        if (!ta || !btn) { toastr && toastr.warning('Не нашёл поле ввода таверны', 'Визуальная новелла'); return false; }
        ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true })); btn.click();
        player.waiting = true;
        if (player.el) player.el.querySelector('#svn-status').classList.add('svn-show');
        updateContinue();
        return true;
    }
    function sendFromPlayer() {
        const input = player.el.querySelector('#svn-input');
        if (sendText(input.value)) input.value = '';
    }

    // ── стриминг: прячем сырую разметку ВЖИВУЮ, пока ответ печатается ──
    // onProgressStreaming таверны пишет chat[id].mes по токенам, поэтому decorateMessage работает и
    // в процессе. Без этого при «скрывать разметку» в ленте мелькает <vn>/JSON картинок/поля статуса,
    // пока стрим не закончится. Событие частое — троттлим.
    let _streamDecorTs = 0;
    function onStreamToken() {
        const s = getSettings(); if (!s.enabled || !s.hideMarkup) return;
        const now = Date.now(); if (now - _streamDecorTs < 300) return; _streamDecorTs = now;
        const chat = getCtx().chat || [];
        const id = chat.length - 1; const msg = chat[id];
        if (!msg || msg.is_user || !isVnMessage(id)) return; // <vn>/картинки ещё не появились в потоке — разметка пока обычный текст
        const mes = getMesEl(id); if (!mes) return;
        decorateMessage(id);              // спрячет .mes_text, поставит карточку
        mes.classList.add('svn-streaming'); // карточка покажет «печатается…» вместо счётчиков
    }
    // конец/обрыв генерации — снять пометку стрима с последнего сообщения, чтобы карточка не висла на «печатается…»
    function onGenDone() {
        const chat = getCtx().chat || [];
        const id = chat.length - 1;
        const mes = getMesEl(id); if (mes) mes.classList.remove('svn-streaming');
        if (id >= 0 && chat[id] && !chat[id].is_user) setTimeout(() => decorateMessage(id), 30);
    }

    function onCharMessageRendered(id) {
        const s = getSettings(); if (!s.enabled) return;
        if (_selfEmit.has(id)) return; // это наш повторный эмит ради генерации картинок — режиссёра/плеер уже отработали
        const mes = getMesEl(id); if (mes) mes.classList.remove('svn-streaming'); // стрим завершён
        const msg = (getCtx().chat || [])[id];
        // РЕЖИССЁР: свежий ответ основного ИИ без своих тегов картинок → мини-ИИ сам ставит N кадров + статус.
        //   (Старые/уже отрежиссированные сообщения имеют сохранённые теги → hasImageTags=true → сюда не попадут.)
        if (msg && !msg.is_user && directorActive() && _directorDone.get(id) !== (msg.swipe_id || 0)
            && !_directorBusy.has(id) && !hasImageTags(msgSource(msg))) {
            runDirector(id); // async; внутри сам вызовет afterDirector (карточка/плеер/модули)
            return;
        }
        afterDirector(id);
    }

    // ── единая панель настроек (из меню «волшебной палочки») ───────────
    // Точка входа: пункт #svn_wand_button в #extensionsMenu открывает панель
    // #svn-cfg поверх всего. Здесь живут И настройки расширения, И «вид плеера».
    function createSettingsUI() {
        ensureWandButton();
        if (document.getElementById('svn-cfg')) return;
        buildSettingsPanel();
    }
    function ensureWandButton() {
        const menu = document.getElementById('extensionsMenu');
        if (!menu || document.getElementById('svn_wand_button')) return;
        const item = document.createElement('div');
        item.id = 'svn_wand_button';
        item.className = 'list-group-item flex-container flexGap5';
        item.title = 'Настройки визуальной новеллы';
        item.innerHTML = '<div class="fa-solid fa-book-open extensionsMenuExtensionButton svn-wand-icon"></div><span>Визуальная новелла</span>';
        item.addEventListener('click', () => openSettingsPanel());
        menu.appendChild(item);
    }
    function selectCfgTab(ov, tab) {
        ov.querySelectorAll('.svn-cfg-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        ov.querySelectorAll('.svn-cfg-pane').forEach(p => p.classList.toggle('show', p.dataset.pane === tab));
    }
    function openSettingsPanel(tab) {
        createSettingsUI();
        const ov = document.getElementById('svn-cfg'); if (!ov) return;
        try { fillSettingSelects(ov); } catch (e) { /* ignore */ }
        try { applyTheme(); } catch (e) { /* ignore */ } // покрасить саму панель в выбранные цвета
        renderModuleList(); updateCastCount();
        if (tab) selectCfgTab(ov, tab);
        ov.classList.add('svn-show');
        document.body.classList.add('svn-lock');
    }
    function closeSettingsPanel() {
        const ov = document.getElementById('svn-cfg'); if (!ov) return;
        ov.classList.remove('svn-show');
        document.body.classList.toggle('svn-lock', !!player.open);
    }
    function buildSettingsPanel() {
        const s = getSettings();
        const hasIIG = !!(getCtx().extensionSettings && getCtx().extensionSettings.inline_image_gen);
        const ov = document.createElement('div');
        ov.id = 'svn-cfg';
        ov.innerHTML =
`<div class="svn-cfg-card" role="dialog" aria-label="Настройки визуальной новеллы">
  <div class="svn-cfg-head">
    <span class="svn-cfg-title"><i class="fa-solid fa-book-open"></i> Визуальная новелла</span>
    <span class="svn-cfg-ver">v1.1</span>
    <label class="svn-cfg-master" title="Включить/выключить режим VN">Включено <input type="checkbox" id="svn_enabled" ${s.enabled ? 'checked' : ''}></label>
    <button type="button" class="svn-cfg-x" data-cfg="close" title="Закрыть (Esc)" aria-label="Закрыть"><i class="fa-solid fa-xmark"></i></button>
  </div>
  <div class="svn-cfg-body">
    <nav class="svn-cfg-rail">
      <div class="svn-cfg-tab active" data-tab="main"><i class="fa-solid fa-sliders"></i><span>Основное</span></div>
      <div class="svn-cfg-tab" data-tab="img"><i class="fa-solid fa-image"></i><span>Картинки</span></div>
      <div class="svn-cfg-tab" data-tab="spr"><i class="fa-solid fa-masks-theater"></i><span>Спрайты</span></div>
      <div class="svn-cfg-tab" data-tab="mod"><i class="fa-solid fa-puzzle-piece"></i><span>Модули</span></div>
      <div class="svn-cfg-tab" data-tab="view"><i class="fa-solid fa-display"></i><span>Вид и плеер</span></div>
    </nav>
    <div class="svn-cfg-content">

      <div class="svn-cfg-pane show" data-pane="main">
        <div class="svn-cfg-preview">
          <svg class="svn-cfg-preview-svg" viewBox="0 0 320 180" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Предпросмотр плеера визуальной новеллы">
            <defs>
              <linearGradient id="svnPvSky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#ffd9ec"/><stop offset="0.55" stop-color="#cdb8ff"/><stop offset="1" stop-color="#9bc4ff"/>
              </linearGradient>
              <radialGradient id="svnPvGlow" cx="0.5" cy="0.4" r="0.62">
                <stop offset="0" stop-color="#fff6cf" stop-opacity="0.85"/><stop offset="1" stop-color="#fff6cf" stop-opacity="0"/>
              </radialGradient>
              <linearGradient id="svnPvBox" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#0a0c12" stop-opacity="0.15"/><stop offset="1" stop-color="#0a0c12" stop-opacity="0.92"/>
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="320" height="180" fill="url(#svnPvSky)"/>
            <circle cx="160" cy="76" r="74" fill="url(#svnPvGlow)"/>
            <g fill="#ffffff" opacity="0.7"><circle cx="44" cy="38" r="2"/><circle cx="272" cy="30" r="1.6"/><circle cx="300" cy="66" r="2.2"/><circle cx="22" cy="88" r="1.5"/><circle cx="250" cy="96" r="1.5"/></g>
            <g>
              <ellipse cx="160" cy="152" rx="46" ry="30" fill="#ffb877"/>
              <path d="M120 70 L132 40 L150 64 Z" fill="#ffb877"/><path d="M200 70 L188 40 L170 64 Z" fill="#ffb877"/>
              <path d="M126 64 L133 48 L143 62 Z" fill="#ff9ec2"/><path d="M194 64 L187 48 L177 62 Z" fill="#ff9ec2"/>
              <ellipse cx="160" cy="96" rx="50" ry="44" fill="#ffc88f"/>
              <circle cx="126" cy="106" r="9" fill="#ff9ec2" opacity="0.55"/><circle cx="194" cy="106" r="9" fill="#ff9ec2" opacity="0.55"/>
              <ellipse cx="142" cy="92" rx="9" ry="12" fill="#3a2b3f"/><ellipse cx="178" cy="92" rx="9" ry="12" fill="#3a2b3f"/>
              <circle cx="145" cy="87" r="3" fill="#ffffff"/><circle cx="181" cy="87" r="3" fill="#ffffff"/>
              <circle cx="139" cy="96" r="1.5" fill="#ffffff" opacity="0.8"/><circle cx="175" cy="96" r="1.5" fill="#ffffff" opacity="0.8"/>
              <path d="M155 104 L165 104 L160 110 Z" fill="#ff7aa8"/>
              <path d="M160 110 q-5 6 -11 3" stroke="#3a2b3f" stroke-width="1.6" fill="none" stroke-linecap="round"/>
              <path d="M160 110 q5 6 11 3" stroke="#3a2b3f" stroke-width="1.6" fill="none" stroke-linecap="round"/>
              <g stroke="#ffffff" stroke-width="1.4" stroke-linecap="round" opacity="0.85">
                <line x1="112" y1="100" x2="92" y2="96"/><line x1="112" y1="106" x2="92" y2="109"/>
                <line x1="208" y1="100" x2="228" y2="96"/><line x1="208" y1="106" x2="228" y2="109"/>
              </g>
            </g>
            <rect x="0" y="0" width="320" height="10" fill="#000000" opacity="0.5"/>
            <rect x="0" y="170" width="320" height="10" fill="#000000" opacity="0.5"/>
            <rect x="14" y="116" width="292" height="50" rx="10" fill="url(#svnPvBox)"/>
            <rect x="14" y="116" width="3.4" height="50" rx="2" fill="var(--svn-accent)"/>
            <text x="26" y="132" font-size="10" font-weight="700" fill="var(--svn-accent)">Мурзик</text>
            <text x="26" y="148" font-size="9" fill="#ffffff" fill-opacity="0.92">Мяу… ты пришёл поиграть со мной?</text>
            <text x="26" y="160" font-size="8.5" fill="#ffffff" fill-opacity="0.5">Так твоя сцена выглядит в плеере.</text>
            <path d="M293 156 l7 0 l-3.5 5 Z" fill="var(--svn-accent)"/>
          </svg>
          <div class="svn-cfg-preview-cap"><i class="fa-solid fa-circle-play"></i> Так выглядит сцена в плеере: фон, спрайт и окно диалога</div>
        </div>
        <div class="svn-cfg-h">Поведение</div>
        <label class="checkbox_label"><input type="checkbox" id="svn_hide" ${s.hideMarkup ? 'checked' : ''}><span>Скрывать разметку в ленте, показывать карточку-лаунчер</span></label>
        <label class="checkbox_label"><input type="checkbox" id="svn_autoopen" ${s.autoOpen ? 'checked' : ''}><span>Автоматически открывать плеер на новом VN-ответе</span></label>
        <div class="svn-cfg-h">Указания модели</div>
        <small class="svn-cfg-note">Добавляется к системному промпту перед каждой генерацией. Например: жанр — мрачное тёмное фэнтези; обращайся к {{user}} на «ты».</small>
        <textarea id="svn_extra" class="text_pole" rows="4" placeholder="Доп. указания для ИИ…">${escapeHtml(s.extraPromptNotes)}</textarea>
        <div class="svn-cfg-h">Мини-ИИ (читает чат)</div>
        <small class="svn-cfg-note">Читает чат отдельно от основного отыгрыша — для панелей-модулей (сцена, отношения, выборы…). Оставь на подключении SillyTavern или подключи свой по API.</small>
        <div class="flex-row"><label for="svn_aisource">Источник мини-ИИ</label><select id="svn_aisource" class="text_pole" style="width:auto;">
          <option value="st">Подключение SillyTavern</option>
          <option value="endpoint">Отдельный эндпоинт (свой)</option>
        </select></div>
        <div id="svn_ep_fields" style="display:none;flex-direction:column;gap:6px;padding:6px 0 9px;border-bottom:1px solid rgba(255,255,255,.06);">
          <input type="text" id="svn_ep_url" class="text_pole" placeholder="URL, напр. https://api.openai.com/v1">
          <input type="password" id="svn_ep_key" class="text_pole" placeholder="API-ключ (если нужен)">
          <div class="flex-row" style="gap:6px;border-bottom:none;padding:0;">
            <div id="svn_ep_modelbox" style="position:relative;flex:1;min-width:0;">
              <input type="text" id="svn_ep_model" class="text_pole" autocomplete="off" placeholder="модель, напр. gpt-4o-mini" style="width:100%;">
              <div id="svn_ep_models" class="svn-modeldd" hidden></div>
            </div>
            <input type="button" id="svn_ep_loadmodels" class="menu_button" value="Модели с сервера" title="Подтянуть список моделей с эндпоинта (нужны URL и ключ выше)">
          </div>
          <input type="button" id="svn_ep_test" class="menu_button" value="Проверить связь" title="Тестовый запрос к эндпоинту: отвечает ли он и умеет ли возвращать JSON (от этого зависят время/отношения/музыка)" style="width:100%;margin-top:2px;">
          <small id="svn_ep_modelstatus" class="svn-cfg-note"></small>
        </div>
      </div>

      <div class="svn-cfg-pane" data-pane="img">
        <div class="svn-cfg-h">Кадры</div>
        <label class="checkbox_label"><input type="checkbox" id="svn_director" ${s.autoDirector !== false ? 'checked' : ''}><span>Мини-ИИ сам ставит кадры (надёжно) <small style="opacity:.6;">— читает готовый ответ и ставит ровно столько кадров, сколько задано ниже. Число соблюдается точно.</small></span></label>
        <div class="flex-row"><label for="svn_minimg">Кадров (картинок) на ответ</label><span class="svn-cfg-range">от <input type="number" id="svn_minimg" class="text_pole" min="1" max="10" value="${Math.max(1, Math.min(parseInt(s.maxImages, 10) || 5, parseInt(s.minImages, 10) || 2))}"> до <input type="number" id="svn_maximg" class="text_pole" min="1" max="10" value="${s.maxImages}"></span></div>
        <small class="svn-cfg-note">Сколько кадров в ответе. С «мини-ИИ сам ставит кадры» соблюдается точно. Для фиксированного числа — «от» и «до» одинаковыми.</small>
        <label class="checkbox_label"><input type="checkbox" id="svn_landscape" ${s.forceLandscape ? 'checked' : ''}><span>Только горизонтальные кадры 16:9 <small style="opacity:.6;">— жёстко правит aspect_ratio, лучше для ПК</small></span></label>
        <div class="flex-row"><label for="svn_imgsize">Качество кадров</label><select id="svn_imgsize" class="text_pole" style="width:auto;">
          <option value="1K"${(s.imageSize || '1K') === '1K' ? ' selected' : ''}>1K (быстро)</option>
          <option value="2K"${s.imageSize === '2K' ? ' selected' : ''}>2K (чётче)</option>
          <option value="4K"${s.imageSize === '4K' ? ' selected' : ''}>4K (медленно)</option>
        </select></div>
        <div class="svn-cfg-h">Источник тегов картинок</div>
        <small class="svn-cfg-note">Плеер показывает картинки любого расширения (&lt;img&gt;, &lt;image&gt;…&lt;/image&gt;, image###…###, [IMG:…]). Выбери, какой формат тега наш промпт будет просить у ИИ:</small>
        <div class="flex-row"><label for="svn_imgformat">Формат тега</label><select id="svn_imgformat" class="text_pole" style="width:auto;">
          <option value="iig">sillyimages (&lt;img data-iig&gt;)</option>
          <option value="image">тег &lt;image&gt;</option>
          <option value="other">другое (свой промпт)</option>
        </select></div>
        <small id="svn_imgformat_hint" class="svn-cfg-note"></small>
        <label class="checkbox_label"><input type="checkbox" id="svn_detectany" ${s.detectAnyImages !== false ? 'checked' : ''}><span>Распознавать картинки в любой обёртке (не только &lt;vn&gt;)</span></label>
        <label class="checkbox_label"><input type="checkbox" id="svn_extblocks" ${s.extBlocksImages !== false ? 'checked' : ''}><span>Внешние блоки (ExtBlocks) для картинок</span></label>
        <small class="svn-cfg-note indent">Картинки идут во внешние блоки (<code>extra.extblocks</code>), а не в текст — пост остаётся чистым. Включи в расширении картинок «Process external blocks». Подхватывает и блоки от других расширений.</small>
        <label class="checkbox_label"><input type="checkbox" id="svn_inject" ${s.injectPrompt !== false ? 'checked' : ''}><span>Инжектить наш VN-промпт (выключи, если весь промпт у тебя свой)</span></label>
        <details><summary>Своё распознавание (regex, для редких расширений)</summary>
          <input type="text" id="svn_imgdetect" class="text_pole" style="margin-top:6px;width:100%;" placeholder="свой regex (пусто = авто)" value="${escapeHtml(s.imgDetect || '')}">
          <small class="svn-cfg-note">JS-regex без флагов, должен матчить тег картинки целиком. Пример: &lt;pic&gt;[\\s\\S]*?&lt;/pic&gt;. Перебивает авто-распознавание.</small>
        </details>
      </div>

      <div class="svn-cfg-pane" data-pane="spr">
        <div class="svn-cfg-h">Каст персонажей</div>
        <small class="svn-cfg-note">Спрайты нескольких персонажей (твой перс, партнёр, {{user}}…) на сцене одновременно; ИИ сам выводит их и меняет эмоции тегами. Ручной контроль — в плеере под кнопкой «люди».</small>
        <label class="checkbox_label"><input type="checkbox" id="svn_spriteauto" ${s.spriteAuto !== false ? 'checked' : ''}><span>ИИ сам расставляет спрайты по сцене</span></label>
        <div class="flex-row" style="border-bottom:none;"><input type="button" id="svn_openmgr" class="menu_button" value="Открыть менеджер спрайтов"><small id="svn_castcount" style="opacity:.7;"></small></div>
      </div>

      <div class="svn-cfg-pane" data-pane="mod">
        <div class="svn-cfg-h">Слой панелей</div>
        <small class="svn-cfg-note">Доп. панели в плеере (сцена, отношения, выборы…). Каждый модуль может дёргать лёгкий ИИ ОТДЕЛЬНО от основного отыгрыша. В плеере панели сворачиваются кнопкой в углу.</small>
        <label class="checkbox_label"><input type="checkbox" id="svn_panels" ${s.panels !== false ? 'checked' : ''}><span>Показывать панели модулей в плеере</span></label>
        <small class="svn-cfg-note">Источник мини-ИИ и свой отдельный эндпоинт настраиваются во вкладке «Основное» → «Мини-ИИ».</small>
        <div class="svn-cfg-h">Музыка</div>
        <div class="flex-row"><label for="svn_plcount">Размер плейлиста (копится по сценам)</label><input type="number" id="svn_plcount" class="text_pole" min="1" max="30" value="${Math.max(1, Math.min(30, parseInt(s.bgmPlaylistCount, 10) || 5))}" style="width:auto;"></div>
        <small class="svn-cfg-note">Когда включён модуль «Музыка», мини-ИИ подбирает столько реальных песен под настроение сцены и собирает плейлист.</small>
        <div class="svn-cfg-h">Активные модули</div>
        <div id="svn_modlist" style="display:flex;flex-direction:column;"></div>
      </div>

      <div class="svn-cfg-pane" data-pane="view">
        <small class="svn-cfg-note">Те же настройки доступны прямо в плеере — кнопка с ползунками. Меняются на лету. Собери свой вид и сохрани его как тему — переключай одним кликом или поделись файлом.</small>
        <div id="svn-theme-host"></div>
        <div class="svn-cfg-h">Сцена и фон</div>
        <label class="svn-set-row"><span>Фон</span><select data-set="bgMode"><option value="generated">Генерация</option><option value="st">Фоны ST</option><option value="custom">Свой</option><option value="dim">Тёмный</option></select></label>
        <button class="svn-set-btn" data-set="pickbg"><i class="fa-solid fa-images"></i> Выбрать фон ST…</button>
        <label class="svn-set-row"><span>Переход</span><select data-set="motion"><option value="none">Нет</option><option value="fade">Плавно</option><option value="cinematic">Кино (Ken Burns)</option><option value="pan">Промотка арта</option></select></label>
        <label class="svn-set-row svn-set-row-pan"><span>Скорость промотки</span><select data-set="panSpeed"><option value="60">очень медленно</option><option value="45">медленно</option><option value="32">обычно</option><option value="20">быстро</option><option value="12">очень быстро</option></select></label>
        <label class="svn-set-row"><span>Кинорамка</span><input type="checkbox" data-set="letterbox"></label>
        <label class="svn-set-row"><span>Виньетка</span><input type="checkbox" data-set="vignette"></label>
        <label class="svn-set-row"><span>Картинка</span><select data-set="imageFit"><option value="cover">Заполнять</option><option value="contain">Целиком</option></select></label>
        <div class="svn-cfg-h">Текст и темп</div>
        <label class="svn-set-row"><span>Печать текста</span><input type="checkbox" data-set="typewriter"></label>
        <label class="svn-set-row"><span>Скорость текста</span><select data-set="typeSpeed"></select></label>
        <label class="svn-set-row"><span>Форматирование (*курсив*, **жирный**)</span><input type="checkbox" data-set="richText"></label>
        <label class="svn-set-row"><span>Выделять прямую речь («…»)</span><input type="checkbox" data-set="quoteHighlight"></label>
        <label class="svn-set-row"><span>Имя говорящего (по спрайту)</span><input type="checkbox" data-set="showSpeaker"></label>
        <label class="svn-set-row"><span>Темп автоплея</span><select data-set="autoSpeed"><option value="slow">медленно</option><option value="normal">обычно</option><option value="fast">быстро</option></select></label>
        <label class="svn-set-row"><span>Шрифт</span><select data-set="fontFamily"><option value="inherit">Как в ST</option><option value="sans">Без засечек</option><option value="serif">С засечками</option><option value="mono">Моноширинный</option><option value="round">Округлый</option><option value="cond">Узкий</option></select></label>
        <label class="svn-set-row"><span>Своё семейство шрифта</span><input type="text" data-set="customFont" class="text_pole" placeholder="напр. Inter, Times…" style="max-width:160px;"></label>
        <label class="svn-set-row"><span>Межстрочный интервал</span><select data-set="lineHeight"><option value="1.3">плотно</option><option value="1.5">1.5</option><option value="1.7">обычно</option><option value="1.9">свободно</option><option value="2.1">очень свободно</option></select></label>
        <label class="svn-set-row"><span>Трекинг (между букв)</span><select data-set="letterSpacing"><option value="0">0</option><option value="0.3">обычно</option><option value="0.6">шире</option><option value="1">1px</option><option value="1.5">1.5px</option></select></label>
        <label class="svn-set-row"><span>Насыщенность текста</span><select data-set="textWeight"><option value="300">тонкий</option><option value="400">обычный</option><option value="500">средний</option><option value="600">полужирный</option><option value="700">жирный</option></select></label>
        <label class="svn-set-row"><span>Выравнивание текста</span><select data-set="textAlign"><option value="left">слева</option><option value="center">по центру</option><option value="justify">по ширине</option></select></label>
        <div class="svn-cfg-h">Макет</div>
        <label class="svn-set-row"><span>Режим окна</span><select data-set="layoutMode"><option value="cinematic">Кинолента</option><option value="card">Плашка</option></select></label>
        <div class="svn-cfg-h">Окно и шрифт</div>
        <label class="svn-set-row"><span>Размер шрифта</span><select data-set="fontSize"></select></label>
        <label class="svn-set-row"><span>Положение окна</span><select data-set="dialogPos"><option value="bottom">внизу</option><option value="top">вверху</option><option value="center">центр</option></select></label>
        <label class="svn-set-row"><span>Ширина окна</span><select data-set="dialogWidth"></select></label>
        <label class="svn-set-row"><span>Высота окна</span><select data-set="dialogHeight"></select></label>
        <label class="svn-set-row"><span>Матовость</span><select data-set="glass"></select></label>
        <label class="svn-set-row"><span>Скругление углов</span><select data-set="dialogRadius"><option value="0">0</option><option value="6">6</option><option value="12">12</option><option value="18">18</option><option value="22">22</option><option value="28">28</option></select></label>
        <label class="svn-set-row"><span>Толщина рамки</span><select data-set="dialogBorder"><option value="0">нет</option><option value="1">1px</option><option value="2">2px</option><option value="3">3px</option></select></label>
        <label class="svn-set-row"><span>Внутренние отступы</span><select data-set="dialogPad"><option value="12">тесно</option><option value="16">16</option><option value="20">обычно</option><option value="24">24</option><option value="28">просторно</option></select></label>
        <label class="svn-set-row"><span>Тень окна</span><select data-set="dialogShadow"><option value="none">нет</option><option value="soft">мягкая</option><option value="md">обычная</option><option value="strong">сильная</option></select></label>
        <label class="svn-set-row"><span>Размер кнопок панели</span><select data-set="ctrlSize"><option value="sm">меньше</option><option value="md">обычные</option><option value="lg">крупные</option></select></label>
        <div class="svn-cfg-h">Цвета</div>
        <label class="svn-set-row"><span>Акцент интерфейса</span><input type="color" data-set="accentColor"></label>
        <label class="svn-set-row"><span>Цвет текста</span><input type="color" data-set="textColor"></label>
        <label class="svn-set-row"><span>Прямая речь</span><input type="color" data-set="speechColor"></label>
        <label class="svn-set-row"><span>Курсив (действия)</span><input type="color" data-set="italicColor"></label>
        <label class="svn-set-row"><span>Жирный</span><input type="color" data-set="boldColor"></label>
        <label class="svn-set-row"><span>Фон окна</span><input type="color" data-set="panelColor"></label>
        <label class="svn-set-row"><span>Имя говорящего</span><input type="color" data-set="speakerColor"></label>
        <label class="svn-set-row"><span>Цвет рамки</span><input type="color" data-set="borderColor"></label>
        <button class="svn-set-btn" data-set="resetColors"><i class="fa-solid fa-rotate-left"></i> Сбросить цвета</button>
        <div class="svn-cfg-h">Управление</div>
        <label class="svn-set-row"><span>Листать тапом по экрану</span><input type="checkbox" data-set="tapAdvance"></label>
        <label class="svn-set-row"><span>Тинт акцента под настроение</span><input type="checkbox" data-set="moodTint"></label>
        <label class="svn-set-row"><span>Параллакс при смене кадра</span><input type="checkbox" data-set="parallax"></label>
        <label class="svn-set-row"><span>Всплывашки держатся</span><select data-set="floatHold"><option value="0.5">короче</option><option value="1">обычно</option><option value="1.8">дольше</option><option value="3">очень долго</option><option value="0">до клика</option></select></label>
      </div>

    </div>
  </div>
  <div class="svn-cfg-foot">
    <span id="svn_iig_status" class="svn-cfg-status ${hasIIG ? 'ok' : 'warn'}"><i class="fa-solid fa-${hasIIG ? 'circle-check' : 'triangle-exclamation'}"></i> ${hasIIG ? 'sillyimages найден — кадры генерируются автоматически' : 'sillyimages не найден — режим «Генерация» будет пустым'}</span>
    <input type="button" id="svn_reinject" class="menu_button" value="Обновить промпт">
  </div>
</div>`;
        document.body.appendChild(ov);
        const wrap = ov;
        const bind = (sel, ev, fn) => wrap.querySelector(sel).addEventListener(ev, fn);
        bind('#svn_enabled', 'change', e => { s.enabled = e.target.checked; saveSettings(); updateInjection(); decorateAll(); });
        bind('#svn_hide', 'change', e => { s.hideMarkup = e.target.checked; saveSettings(); decorateAll(); });
        bind('#svn_autoopen', 'change', e => { s.autoOpen = e.target.checked; saveSettings(); });
        bind('#svn_maximg', 'input', e => {
            s.maxImages = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 5));
            if ((parseInt(s.minImages, 10) || 1) > s.maxImages) { s.minImages = s.maxImages; const mn = wrap.querySelector('#svn_minimg'); if (mn) mn.value = s.minImages; }
            saveSettings(); updateInjection();
        });
        bind('#svn_minimg', 'input', e => {
            let v = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1));
            const mx = Math.max(1, Math.min(10, parseInt(s.maxImages, 10) || 5));
            if (v > mx) { v = mx; e.target.value = v; }
            s.minImages = v; saveSettings(); updateInjection();
        });
        bind('#svn_director', 'change', e => { s.autoDirector = e.target.checked; saveSettings(); updateInjection(); syncImgHint(); toastr && toastr.info(e.target.checked ? 'Мини-ИИ сам ставит кадры — основному ИИ инструкций про картинки не уходит' : 'Кадры ставит основной ИИ по инструкции в промпте', 'Визуальная новелла'); });
        bind('#svn_landscape', 'change', e => { s.forceLandscape = e.target.checked; saveSettings(); updateInjection(); });
        bind('#svn_imgsize', 'change', e => { s.imageSize = e.target.value; saveSettings(); updateInjection(); });
        bind('#svn_detectany', 'change', e => { s.detectAnyImages = e.target.checked; saveSettings(); decorateAll(); });
        bind('#svn_extblocks', 'change', e => {
            s.extBlocksImages = e.target.checked; saveSettings(); decorateAll();
            if (e.target.checked) {
                const iig = getCtx().extensionSettings && getCtx().extensionSettings.inline_image_gen;
                if (iig && iig.externalBlocks === false)
                    toastr && toastr.warning('В расширении картинок включи «Process external blocks» — иначе кадры из внешних блоков не сгенерируются', 'Визуальная новелла', { timeOut: 8000 });
            }
        });
        bind('#svn_inject', 'change', e => { s.injectPrompt = e.target.checked; saveSettings(); updateInjection(); toastr && toastr.info(e.target.checked ? 'Наш VN-промпт включён' : 'Наш VN-промпт выключен — правит твой промпт', 'Визуальная новелла'); });
        const imgfmtSel = wrap.querySelector('#svn_imgformat'); imgfmtSel.value = s.imgFormat || 'iig';
        const imgHint = wrap.querySelector('#svn_imgformat_hint');
        const syncImgHint = () => {
            const fmt = s.imgFormat || 'iig';
            let txt = ({
                iig: 'Кадры в формате sillyimages (<img data-iig>).',
                image: 'Кадры в формате <image>промпт</image> — под своё расширение картинок.',
                other: 'Формат тегов не наш — за них отвечает твоё расширение. Покажем, что появится.',
            })[fmt] || '';
            if (s.autoDirector !== false) {
                txt += (fmt === 'other')
                    ? ' ⚠ «Мини-ИИ сам ставит кадры» работает только с форматами sillyimages и <image> — для «другого» расширения он выключается, кадры ставит основной ИИ.'
                    : ' Мини-ИИ собирает теги этого формата сам.';
            }
            imgHint.textContent = txt;
        };
        syncImgHint();
        bind('#svn_imgformat', 'change', e => { s.imgFormat = e.target.value; saveSettings(); syncImgHint(); updateInjection(); });
        bind('#svn_imgdetect', 'input', e => { s.imgDetect = e.target.value; saveSettings(); decorateAll(); });
        bind('#svn_spriteauto', 'change', e => { s.spriteAuto = e.target.checked; saveSettings(); updateInjection(); if (player.open) renderSprites(); });
        bind('#svn_openmgr', 'click', () => { closeSettingsPanel(); player.mgrReturnToCfg = true; loadSpriteCache().then(() => openCastManager(true)); });
        bind('#svn_extra', 'input', e => { s.extraPromptNotes = e.target.value; saveSettings(); updateInjection(); });
        bind('#svn_reinject', 'click', () => { updateInjection(); toastr && toastr.success('Системный промпт обновлён', 'Визуальная новелла'); });
        // движок модулей
        const epFields = wrap.querySelector('#svn_ep_fields');
        const aiSel = wrap.querySelector('#svn_aisource');
        aiSel.value = s.aiSource || 'st';
        const syncEp = () => { epFields.style.display = (s.aiSource === 'endpoint') ? 'flex' : 'none'; };
        syncEp();
        wrap.querySelector('#svn_ep_url').value = s.liteEndpoint || '';
        wrap.querySelector('#svn_ep_key').value = s.liteKey || '';
        wrap.querySelector('#svn_ep_model').value = s.liteModel || '';
        // выпадашка моделей: СВОЯ, а не нативный <datalist>. Нативный список прячет варианты,
        // не совпавшие с текстом поля, поэтому при заполненном поле показывал лишь одну модель из нескольких.
        // Наша по фокусу показывает ВЕСЬ список и фильтрует только когда юзер реально печатает.
        const modelsDd = wrap.querySelector('#svn_ep_models');
        const modelInput = wrap.querySelector('#svn_ep_model');
        let modelActive = -1;
        const buildModelDd = (filter) => {
            const f = String(filter || '').trim().toLowerCase();
            const shown = (s.liteModels || []).filter(m => !f || m.toLowerCase().includes(f));
            modelActive = -1;
            if (!shown.length) { modelsDd.innerHTML = ''; modelsDd.hidden = true; return; }
            modelsDd.innerHTML = shown.map(m => `<div class="svn-modeldd-opt${m === s.liteModel ? ' is-sel' : ''}" data-val="${escapeHtml(m)}">${escapeHtml(m)}</div>`).join('');
            modelsDd.hidden = false;
        };
        const hideModelDd = () => { modelsDd.hidden = true; modelActive = -1; };
        const pickModel = (val) => { modelInput.value = val; s.liteModel = val.trim(); saveSettings(); hideModelDd(); };
        // открыть по фокусу/клику — ВСЕГДА весь список (не фильтруя по текущему значению поля)
        modelInput.addEventListener('focus', () => buildModelDd(''));
        modelInput.addEventListener('mousedown', () => { if (modelsDd.hidden) buildModelDd(''); });
        modelsDd.addEventListener('mousedown', (e) => { const o = e.target.closest('.svn-modeldd-opt'); if (!o) return; e.preventDefault(); pickModel(o.dataset.val); });
        modelInput.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' && modelsDd.hidden) { buildModelDd(''); e.preventDefault(); return; }
            const opts = Array.from(modelsDd.querySelectorAll('.svn-modeldd-opt'));
            if (modelsDd.hidden || !opts.length) return;
            if (e.key === 'ArrowDown') modelActive = Math.min(modelActive + 1, opts.length - 1);
            else if (e.key === 'ArrowUp') modelActive = Math.max(modelActive - 1, 0);
            else if (e.key === 'Enter' && modelActive >= 0) { e.preventDefault(); pickModel(opts[modelActive].dataset.val); return; }
            else if (e.key === 'Escape') { hideModelDd(); return; }
            else return;
            e.preventDefault();
            opts.forEach((o, i) => o.classList.toggle('is-active', i === modelActive));
            if (opts[modelActive]) opts[modelActive].scrollIntoView({ block: 'nearest' });
        });
        // клик вне поля закрывает список (оверлей удаляется при закрытии панели — утечки слушателя нет)
        ov.addEventListener('mousedown', (e) => { if (!e.target.closest('#svn_ep_modelbox')) hideModelDd(); });
        bind('#svn_panels', 'change', e => { s.panels = e.target.checked; saveSettings(); if (player.open) engineOnOpen(); });
        bind('#svn_aisource', 'change', e => { s.aiSource = e.target.value; saveSettings(); syncEp(); });
        bind('#svn_ep_url', 'input', e => { s.liteEndpoint = e.target.value.trim(); saveSettings(); });
        bind('#svn_ep_key', 'input', e => { s.liteKey = e.target.value; saveSettings(); });
        bind('#svn_ep_model', 'input', e => { s.liteModel = e.target.value.trim(); saveSettings(); buildModelDd(e.target.value); });
        // кнопка «Модели с сервера»: тянем список моделей с эндпоинта и кладём в выпадашку
        bind('#svn_ep_loadmodels', 'click', async () => {
            const stat = wrap.querySelector('#svn_ep_modelstatus');
            const btn = wrap.querySelector('#svn_ep_loadmodels');
            if (stat) { stat.textContent = 'Загружаю модели…'; stat.style.color = ''; }
            if (btn) btn.disabled = true;
            try {
                const ids = await fetchLiteModels();
                s.liteModels = ids; saveSettings();
                if (ids.length && !s.liteModel) { s.liteModel = ids[0]; saveSettings(); modelInput.value = ids[0]; }
                if (stat) { stat.textContent = ids.length ? `Найдено моделей: ${ids.length}. Выбери из списка ниже.` : 'Сервер не вернул список моделей.'; stat.style.color = ids.length ? '' : 'var(--svn-accent)'; }
                if (ids.length) { modelInput.focus(); buildModelDd(''); }
            } catch (err) {
                if (stat) { stat.textContent = 'Не вышло: ' + (err && err.message ? err.message : err); stat.style.color = 'var(--svn-accent)'; }
            } finally { if (btn) btn.disabled = false; }
        });
        // кнопка «Проверить связь»: реальный тест chat/completions именно тем путём, что используют модули
        bind('#svn_ep_test', 'click', async () => {
            const stat = wrap.querySelector('#svn_ep_modelstatus');
            const btn = wrap.querySelector('#svn_ep_test');
            if (stat) { stat.textContent = 'Проверяю связь…'; stat.style.color = ''; }
            if (btn) btn.disabled = true;
            try {
                const raw = await askLiteEndpoint('Ты — тест. Ответь строго JSON, без пояснений.', 'Верни ровно {"ok":true} и больше ничего.', true, 40);
                const parsed = parseLooseJson(raw);
                if (parsed && typeof parsed === 'object') {
                    if (stat) { stat.textContent = '✓ Связь есть, модель вернула JSON — время/отношения/музыка должны заполняться. Не забудь включить нужные модули (вкладка «Модули»).'; stat.style.color = ''; }
                } else {
                    if (stat) { stat.textContent = '⚠ Эндпоинт ответил, но без JSON (вернул: «' + String(raw || '').replace(/\s+/g, ' ').slice(0, 50) + '…»). Модель слабовата для модулей — выбери модель поумнее.'; stat.style.color = 'var(--svn-accent)'; }
                }
            } catch (err) {
                if (stat) { stat.textContent = '✗ Эндпоинт не ответил: ' + (err && err.message ? err.message : err); stat.style.color = 'var(--svn-accent)'; }
            } finally { if (btn) btn.disabled = false; }
        });
        bind('#svn_plcount', 'input', e => { s.bgmPlaylistCount = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || 5)); saveSettings(); });
        renderModuleList();
        updateCastCount();
        // вкладки
        ov.querySelectorAll('.svn-cfg-tab').forEach(t => t.addEventListener('click', () => selectCfgTab(ov, t.dataset.tab)));
        // вкладка «Вид и плеер»: заполняем селекты, рисуем темы-пресеты и вешаем общую проводку
        try { fillSettingSelects(ov); } catch (e) { /* ignore */ }
        { const host = ov.querySelector('#svn-theme-host'); if (host) try { renderPresetUI(host); } catch (e) { /* ignore */ } }
        wireViewSettings(ov);
        // закрытие: крестик, клик по фону, Esc
        ov.querySelector('[data-cfg="close"]').addEventListener('click', closeSettingsPanel);
        ov.addEventListener('mousedown', e => { if (e.target === ov) closeSettingsPanel(); });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            const o = document.getElementById('svn-cfg');
            if (o && o.classList.contains('svn-show')) { e.stopPropagation(); closeSettingsPanel(); }
        }, true);
    }
    function renderModuleList() {
        const host = document.getElementById('svn_modlist'); if (!host) return;
        if (!MODULES.length) { host.innerHTML = '<small style="opacity:.6;">Модулей пока нет.</small>'; return; }
        host.innerHTML = MODULES.map(m =>
            `<label class="checkbox_label" style="align-items:flex-start;gap:8px;">
               <input type="checkbox" data-mod="${escapeHtml(m.id)}" ${moduleEnabled(m.id) ? 'checked' : ''} style="margin-top:3px;">
               <span><b>${escapeHtml(m.name)}</b>${m.desc ? `<br><small style="opacity:.7;">${escapeHtml(m.desc)}</small>` : ''}</span>
             </label>`).join('');
        host.querySelectorAll('input[data-mod]').forEach(el =>
            el.addEventListener('change', () => setModuleEnabled(el.dataset.mod, el.checked)));
    }
    function updateCastCount() {
        const el = document.getElementById('svn_castcount');
        if (!el) return;
        const n = getCast().length;
        const withImg = getCast().filter(a => actorEmotions(a).length).length;
        el.textContent = n ? `Персонажей: ${n}${withImg < n ? ` (с картинками: ${withImg})` : ''}` : 'Персонажей пока нет';
    }

    // жёсткая страховка: переписываем aspect_ratio→16:9 в ответе ДО того, как sillyimages начнёт генерацию
    // (срабатывает на MESSAGE_RECEIVED, раньше CHARACTER_MESSAGE_RENDERED; работает с ЛЮБЫМ промптом картинок,
    //  даже если он ставит random/вертикаль вроде {{random:1:1::2:3::...}})
    function enforceImageDefaults(id) {
        const s = getSettings();
        if (!s.enabled) return;
        const wantLand = s.forceLandscape !== false;
        const wantSize = (s.imageSize === '2K' || s.imageSize === '4K') ? s.imageSize : null;
        if (!wantLand && !wantSize) return;
        const msg = (getCtx().chat || [])[id];
        if (!msg || msg.is_user) return;
        const mes = msg.mes || '';
        let out = mes;
        if (wantLand && out.indexOf('aspect_ratio') !== -1)
            out = out.replace(/("aspect_ratio"\s*:\s*")[^"]*(")/gi, (m, a, b) => a + '16:9' + b);
        if (wantSize && out.indexOf('image_size') !== -1)
            out = out.replace(/("image_size"\s*:\s*")[^"]*(")/gi, (m, a, b) => a + wantSize + b);
        if (out !== mes) msg.mes = out;
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  ДВИЖОК МОДУЛЕЙ                                                 ║
    // ║  Модуль = панель в плеере + липкое состояние (по чату) +        ║
    // ║  НЕОБЯЗАТЕЛЬНЫЙ лёгкий ИИ-вызов. Два бэкенда лёгкого ИИ:        ║
    // ║   • 'st'       — текущее подключение таверны (generateRaw)      ║
    // ║   • 'endpoint' — свой OpenAI-совместимый /chat/completions      ║
    // ╚════════════════════════════════════════════════════════════════╝

    // ── лёгкий ИИ: один вызов, два бэкенда ────────────────────────────
    const _liteBusy = new Map(); // moduleId -> bool (анти-дубль одновременных запросов)
    const _liteError = new Map(); // moduleId -> true, если последний лёгкий ИИ-вызов упал (для индикатора с «повторить» вместо вечного спиннера)
    // КРИТИЧНО: вызовы к бэкенду таверны (generateRaw) НЕЛЬЗЯ пускать параллельно —
    // у них общий стейт генерации (TempResponseLength, abort-хуки), и одновременные
    // запросы рушат друг друга (раньше из 2–3 модулей срабатывал лишь один — отсюда
    // вечные «читаю сцену…»). Поэтому ВСЕ лёгкие вызовы выстраиваем в очередь и
    // выполняем строго по одному.
    let _liteChain = Promise.resolve();
    let _liteFailToastAt = 0; // троттл всплывашек об ошибке мини-ИИ (иначе спам на каждом ходе)
    function notifyLiteFail(e, where) {
        if (getSettings().aiSource !== 'endpoint') return; // на встроенном ИИ ST свои тосты — не дублируем
        const now = Date.now();
        if (now - _liteFailToastAt < 15000) return;
        _liteFailToastAt = now;
        const msg = (e && e.message) ? e.message : String(e || 'нет ответа');
        try { toastr && toastr.warning((where ? where + '\n' : '') + msg, 'VN · мини-ИИ', { timeOut: 8000 }); } catch (_) { /* ignore */ }
    }
    // СВОДКА режиссёра (только при своём эндпоинте) — чтобы ВИДЕТЬ, что мини-ИИ реально вернул:
    // сколько кадров отдала модель, сколько поставлено, есть ли музыка и статус. Ответ на «или мне кажется, проверяй».
    let _dirSummaryAt = 0;
    function directorSummary(data, placed) {
        if (getSettings().aiSource !== 'endpoint') return; // ST-источник не трогаем
        const now = Date.now();
        if (now - _dirSummaryAt < 8000) return; // не спамим каждый ход
        _dirSummaryAt = now;
        data = data || {};
        const fromModel = Array.isArray(data.frames) ? data.frames.filter(Boolean).length : 0;
        const pl = Array.isArray(data.playlist) ? data.playlist.filter(Boolean).length : 0;
        const stObj = (data.status && typeof data.status === 'object') ? data.status : data;
        const stKeys = (stObj && typeof stObj === 'object') ? Object.keys(stObj).filter(k => !['frames', 'playlist', 'sprites'].includes(k) && String(stObj[k] || '').trim()) : [];
        const weak = fromModel === 0; // модель не дала ни кадра → JSON не распарсился/пустой
        const parts = [
            `кадров: модель ${fromModel}${placed != null && placed !== fromModel ? ` → поставлено ${placed}` : ''}`,
            pl ? `музыка: ${pl}` : 'музыки нет',
            stKeys.length ? `статус: ${stKeys.join(', ')}` : 'статуса нет',
        ];
        try {
            if (weak) toastr && toastr.warning(parts.join('\n') + '\nМодель эндпоинта не вернула данные — нажми «Проверить связь» в настройках или возьми модель поумнее (или верни мини-ИИ на «таверну»).', 'VN · режиссёр', { timeOut: 9000 });
            else toastr && toastr.info(parts.join(' · '), 'VN · режиссёр', { timeOut: 5000 });
        } catch (_) { /* ignore */ }
    }
    function askLite(opts) {
        const run = () => {
            const { system = '', user = '', json = null, maxTokens = 400 } = opts || {};
            const p = getSettings().aiSource === 'endpoint'
                ? askLiteEndpoint(system, user, json, maxTokens)
                : askLiteST(system, user, json, maxTokens);
            return withTimeout(p, 90000); // страховка от зависшего вызова, чтобы очередь не встала навсегда
        };
        const result = _liteChain.then(run, run);
        _liteChain = result.then(() => {}, () => {}); // звено очереди не должно ронять следующих
        return result;
    }
    function withTimeout(p, ms) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('лёгкий ИИ: превышено время ожидания')), ms);
            Promise.resolve(p).then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
        });
    }
    async function askLiteST(system, user, json, maxTokens) {
        const ctx = getCtx();
        const schema = (json && typeof json === 'object') ? json : undefined; // boolean json => без схемы, парсим вольно
        if (typeof ctx.generateRaw === 'function') {
            try { return await ctx.generateRaw({ prompt: user || '...', systemPrompt: system, responseLength: maxTokens, jsonSchema: schema }); }
            catch (e) { /* пробуем quiet */ }
        }
        if (typeof ctx.generateQuietPrompt === 'function') {
            const q = (system ? system + '\n\n' : '') + (user || '');
            try { return await ctx.generateQuietPrompt({ quietPrompt: q, responseLength: maxTokens, jsonSchema: schema }); }
            catch (e) { return await ctx.generateQuietPrompt(q, false, false); }
        }
        throw new Error('В этой версии SillyTavern нет доступной генерации (generateRaw/generateQuietPrompt)');
    }
    async function askLiteEndpoint(system, user, json, maxTokens) {
        const s = getSettings();
        let ep = String(s.liteEndpoint || '').trim().replace(/\/+$/, '');
        if (!ep) throw new Error('Не задан адрес отдельного эндпоинта (настройки VN → Движок модулей)');
        if (!/\/chat\/completions$/.test(ep)) ep += '/chat/completions';
        const hdrs = { 'Content-Type': 'application/json' };
        if (s.liteKey) hdrs['Authorization'] = 'Bearer ' + s.liteKey;
        const messages = [];
        if (system) messages.push({ role: 'system', content: system });
        messages.push({ role: 'user', content: user || '...' });
        const base = { model: s.liteModel || 'gpt-4o-mini', messages, stream: false, max_tokens: maxTokens };
        const callOnce = async (withFormat) => {
            const body = withFormat ? Object.assign({ response_format: { type: 'json_object' } }, base) : base;
            const r = await fetch(ep, { method: 'POST', headers: hdrs, body: JSON.stringify(body) });
            if (!r.ok) { const t = (await r.text()).slice(0, 200); const err = new Error('HTTP ' + r.status + ': ' + t); err.httpStatus = r.status; throw err; }
            const data = await r.json();
            if (data.choices && data.choices[0]) return (data.choices[0].message && data.choices[0].message.content) || data.choices[0].text || '';
            if (typeof data.content === 'string') return data.content;
            return JSON.stringify(data);
        };
        if (!json) return callOnce(false);
        try { return await callOnce(true); }
        catch (e) {
            // Многие OpenAI-совместимые прокси/модели НЕ понимают response_format:json_object и отвечают 4xx.
            // Повторяем БЕЗ него — JSON всё равно вытащим из текста (parseLooseJson / спасатель режиссёра).
            if (e && e.httpStatus >= 400 && e.httpStatus < 500) return callOnce(false);
            throw e;
        }
    }
    // подтянуть список моделей с отдельного эндпоинта (GET /models, формат OpenAI) — для кнопки в настройках
    async function fetchLiteModels() {
        const s = getSettings();
        let ep = String(s.liteEndpoint || '').trim().replace(/\/+$/, '');
        if (!ep) throw new Error('сначала укажи URL эндпоинта');
        ep = ep.replace(/\/chat\/completions$/, '');
        if (!/\/models$/.test(ep)) ep += '/models';
        const hdrs = {};
        if (s.liteKey) hdrs['Authorization'] = 'Bearer ' + s.liteKey;
        const r = await fetch(ep, { headers: hdrs });
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 80));
        const d = await r.json();
        const arr = Array.isArray(d) ? d : (Array.isArray(d.data) ? d.data : (Array.isArray(d.models) ? d.models : []));
        const ids = arr.map(m => (typeof m === 'string' ? m : (m && (m.id || m.name || m.model)))).filter(Boolean);
        return Array.from(new Set(ids));
    }
    // обёртка модуля: анти-дубль + (опц.) разбор JSON
    async function moduleAsk(moduleId, opts) {
        if (_liteBusy.get(moduleId)) return null;
        _liteBusy.set(moduleId, true);
        try {
            const raw = await askLite(opts);
            _liteError.delete(moduleId); // успех — снимаем флаг ошибки
            return (opts && opts.json) ? parseLooseJson(raw) : raw;
        } catch (e) {
            console.warn('[VN] лёгкий ИИ (' + moduleId + '):', e);
            notifyLiteFail(e, 'Модуль «' + moduleId + '» не смог дочитать сцену через твой эндпоинт.');
            _liteError.set(moduleId, true); // провал — панель покажет «не вышло — ⟳ повторить» вместо вечного спиннера
            if (player.open) { const def = MODULES.find(m => m.id === moduleId); if (def) renderModulePanel(def); }
            return null;
        } finally { _liteBusy.set(moduleId, false); }
    }
    function parseLooseJson(s) {
        if (s == null) return null;
        if (typeof s === 'object') return s;
        let t = String(s).trim();
        const m = t.match(/\{[\s\S]*\}/);
        if (m) t = m[0];
        try { return JSON.parse(t); } catch (e) { return null; }
    }
    // индикатор «лёгкий ИИ не ответил — ⟳ повторить» (вместо вечного спиннера при кривом/недоступном эндпоинте)
    function liteErrorChip(moduleId, label) {
        return `<div class="svn-pan-chip svn-pan-err"><i class="fa-solid fa-triangle-exclamation"></i> <span>${escapeHtml(label)}</span><button type="button" class="svn-lite-retry" data-mod="${escapeHtml(moduleId)}" title="Повторить"><i class="fa-solid fa-rotate-right"></i></button></div>`;
    }
    function bindLiteRetry(body) {
        const btn = body && body.querySelector('.svn-lite-retry'); if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.mod;
            const def = MODULES.find(m => m.id === id); if (!def) return;
            _liteError.delete(id);
            renderModulePanel(def); // сразу вернуть спиннер
            try { def.onTurn && def.onTurn(def._api, player.mesId); } catch (err) { /* ignore */ }
        });
    }

    // ── контекст для лёгкого ИИ: последние реплики чата ───────────────
    function recentTurns(n) {
        const ctx = getCtx(); const chat = ctx.chat || [];
        const out = [];
        for (let i = chat.length - 1; i >= 0 && out.length < n; i--) {
            const msg = chat[i]; if (!msg) continue;
            let t = msg.mes || '';
            const vn = sceneSource(t); if (vn != null) t = vn;
            t = cleanText(t.replace(/<choices\b[^>]*>[\s\S]*?<\/choices>/gi, '').replace(imgMarkRe('gi'), '').replace(/<sprite\b[^>]*>/gi, '')).replace(/\s+/g, ' ').trim();
            if (!t) continue;
            const who = msg.is_user ? (ctx.name1 || 'Игрок') : (ctx.name2 || 'Персонаж');
            out.unshift(who + ': ' + t.slice(0, 600));
        }
        return out.join('\n');
    }

    // ── липкое состояние модулей (отдельно на каждый чат) ─────────────
    function stateKey() {
        const ctx = getCtx();
        try { if (typeof ctx.getCurrentChatId === 'function') { const id = ctx.getCurrentChatId(); if (id) return String(id); } } catch (e) { /* ignore */ }
        return ctx.characterId != null ? 'char' + ctx.characterId : 'global';
    }
    function allModuleState() {
        const s = getSettings();
        if (!s.moduleState || typeof s.moduleState !== 'object') s.moduleState = {};
        const k = stateKey();
        if (!s.moduleState[k]) s.moduleState[k] = {};
        return s.moduleState[k];
    }
    function getModState(id) { return allModuleState()[id] || null; }
    function setModState(id, data) { allModuleState()[id] = data; saveSettings(); }
    // снапшот/откат ВСЕГО состояния модулей текущего чата (для отката хода при пере-свайпе).
    // Глубокая копия обязательна: love/inventory мутируются по ссылке (см. applyLoveDeltas/invApply).
    function snapshotModuleState() {
        try { return structuredClone(allModuleState()); } catch (e) { return JSON.parse(JSON.stringify(allModuleState())); }
    }
    function restoreModuleState(snap) {
        if (!snap) return;
        const s = getSettings();
        if (!s.moduleState || typeof s.moduleState !== 'object') s.moduleState = {};
        let clone; try { clone = structuredClone(snap); } catch (e) { clone = JSON.parse(JSON.stringify(snap)); }
        s.moduleState[stateKey()] = clone; // переустановка объекта — старые ссылки модулей больше не в стейте
        saveSettings();
    }

    // ── реестр модулей ────────────────────────────────────────────────
    const MODULES = [];
    let _loveReveal = false; // показывать ли скрытые числа отношений (куплено за искры; сбрасывается на новой сцене)
    function moduleCfg(id) {
        const s = getSettings();
        if (!s.modules || typeof s.modules !== 'object') s.modules = {};
        if (!s.modules[id]) s.modules[id] = {};
        return s.modules[id];
    }
    function moduleEnabled(id) {
        const def = MODULES.find(m => m.id === id);
        const cfg = moduleCfg(id);
        return Object.hasOwn(cfg, 'enabled') ? !!cfg.enabled : !!(def && def.defaultOn);
    }
    function setModuleEnabled(id, on) {
        moduleCfg(id).enabled = !!on; saveSettings();
        updateInjection();
        const def = MODULES.find(m => m.id === id);
        if (!def) return;
        if (on && player.open) {
            try { def.onOpen && def.onOpen(def._api); } catch (e) { /* ignore */ }
            // нет липкого состояния? — populate сразу, чтобы панель не висела на спиннере
            try { if (!getModState(id) && def.onTurn) def.onTurn(def._api, player.mesId); } catch (e) { /* ignore */ }
        }
        if (player.open) renderModulePanel(def);
    }
    function moduleApi(def) {
        return {
            id: def.id,
            getState: () => getModState(def.id),
            setState: (d) => { setModState(def.id, d); renderModulePanel(def); },
            cfg: () => moduleCfg(def.id),
            ask: (opts) => moduleAsk(def.id, opts),
            recentTurns,
            // распарсенный <vn-status> (+<datetime>) указанного сообщения (по умолчанию — открытое в плеере)
            parseStatus: (mesId) => parseVnStatus((((getCtx().chat || [])[mesId != null ? mesId : player.mesId]) || {}).mes || ''),
            getCtx, getSettings,
            charName: () => String(getCtx().name2 || 'Персонаж'),
            userName: () => String(getCtx().name1 || 'Игрок'),
            scene: () => player.scene,
            frame: () => (player.scene ? player.scene.frames[player.frame] : null),
            panelBody: () => modulePanelBody(def.id),
            toast: (m) => { try { toastr && toastr.info(m, 'VN · ' + def.name); } catch (e) { /* ignore */ } },
            float: (o) => playerFloat((o && o.text) || '', o && o.kind),
            overlay: () => player.el,
            isLastFrame: () => !!(player.scene && player.frame >= player.scene.frames.length - 1),
            send: (t) => sendText(t),
            refresh: () => renderModulePanel(def),
        };
    }
    function registerModule(def) {
        if (!def || !def.id || MODULES.find(m => m.id === def.id)) return;
        MODULES.push(def);
        def._api = moduleApi(def);
    }
    // вклад включённых модулей в системный промпт (напр. choices учит ИИ писать <choices>)
    // wantDynamic=false → статичные заметки (в кэшируемый гайд); true → динамичные, зависящие от состояния
    // (инвентарь/цели — их место в depth=2-реминдере, чтобы не бить кэш гайда при каждом изменении).
    function modulePromptNotes(wantDynamic) {
        return MODULES.filter(m => moduleEnabled(m.id) && typeof m.promptNote === 'function' && !!m.promptNoteDynamic === !!wantDynamic)
            .map(m => { try { return m.promptNote(m._api); } catch (e) { return ''; } })
            .filter(Boolean).join('\n\n');
    }
    // ОДИН общий блок <vn-status>: собираем поля у всех включённых модулей (statusFields).
    // Основной ИИ пишет его в КОНЦЕ ответа — это заменяет отдельные вызовы лёгкого ИИ
    // (лёгкий ИИ остаётся запасным, если тега в ответе не оказалось).
    function buildStatusNote() {
        const fields = [];
        for (const m of MODULES) {
            if (!moduleEnabled(m.id) || typeof m.statusFields !== 'function') continue;
            try { const f = m.statusFields(m._api); if (Array.isArray(f)) for (const x of f) if (x) fields.push(x); } catch (e) { /* ignore */ }
        }
        if (!fields.length) return '';
        return `[Статус сцены — служебный блок]
В САМОМ КОНЦЕ ответа, ВНУТРИ <vn> (после всего повествования и картинок), добавь компактный блок статуса. Каждое поле — с новой строки, короткое значение; пиши ТОЛЬКО те поля, что реально знаешь. Игрок этот блок НЕ видит — он нужен интерфейсу.
<vn-status>
${fields.join('\n')}
</vn-status>`;
    }

    // ── слой панелей в плеере ──────────────────────────────────────────
    function panelsHost() { return player.el ? player.el.querySelector('#svn-panels-list') : null; }
    // тумблер «свернуть панель управления»: прячет всю строку кнопок, оставляя одну кнопку-развернуть
    function setCtrlCollapsed(on) {
        getSettings().ctrlCollapsed = !!on; saveSettings();
        if (on && player.el) { // сворачиваем — закрываем открытые подпанели, чтобы не висели поверх
            player.el.querySelector('#svn-settings').classList.remove('svn-show');
            player.el.querySelector('#svn-cast-panel').classList.remove('svn-show');
        }
        updateCtrlChrome();
    }
    function updateCtrlChrome() {
        const bar = player.el && player.el.querySelector('#svn-ctrl'); if (!bar) return;
        const collapsed = !!getSettings().ctrlCollapsed;
        bar.classList.toggle('svn-ctrl-collapsed', collapsed);
        const btn = bar.querySelector('.svn-ctrl-toggle');
        if (btn) {
            btn.innerHTML = collapsed ? '<i class="fa-solid fa-bars"></i>' : '<i class="fa-solid fa-angles-right"></i>';
            btn.title = collapsed ? 'Развернуть панель' : 'Свернуть панель';
        }
    }
    function setPanelsCollapsed(on) { getSettings().panelsCollapsed = !!on; saveSettings(); updatePanelsChrome(); }
    // тумблер «свернуть/показать»: прячет весь HUD, оставляя крошечную кнопку
    function updatePanelsChrome() {
        const root = player.el && player.el.querySelector('#svn-panels'); if (!root) return;
        const list = root.querySelector('#svn-panels-list');
        const has = !!(list && list.children.length);
        root.classList.toggle('svn-has-panels', has);
        const collapsed = !!getSettings().panelsCollapsed;
        root.classList.toggle('svn-collapsed', collapsed);
        const btn = root.querySelector('#svn-panels-toggle');
        if (btn) {
            btn.innerHTML = collapsed ? '<i class="fa-solid fa-layer-group"></i>' : '<i class="fa-solid fa-chevron-up"></i>';
            btn.title = collapsed ? 'Показать панели' : 'Скрыть панели';
        }
    }
    // всплывающая плашка поверх сцены (для love-score, выборов и т.п.)
    // контейнер всплывашек: складываем их в колонку сверху по центру (а не валим друг на друга)
    function floatsHost() {
        const ov = player.el; if (!ov) return null;
        let h = ov.querySelector('#svn-floats');
        if (!h) { h = document.createElement('div'); h.id = 'svn-floats'; ov.appendChild(h); }
        return h;
    }
    function playerFloat(text, kind) {
        const host = floatsHost(); if (!host || !player.open || !text) return;
        const el = document.createElement('div');
        el.className = 'svn-float svn-float-' + (kind || 'info');
        el.textContent = text;
        host.appendChild(el);
        requestAnimationFrame(() => el.classList.add('svn-float-on'));
        // держим дольше (чтобы успеть прочитать), время растёт с длиной; тап/клик — убрать раньше.
        // регулятор floatHold: множитель времени; 0 = висит до клика (sticky).
        let killed = false;
        const kill = () => { if (killed) return; killed = true; el.classList.remove('svn-float-on'); setTimeout(() => { if (el.parentNode) el.remove(); }, 450); };
        const hold = getSettings().floatHold;
        let t = null;
        if (hold === 0) { el.classList.add('svn-float-sticky'); }
        else {
            const mul = (typeof hold === 'number' && hold > 0) ? hold : 1;
            const dur = Math.min(15000 * Math.max(1, mul), (4500 + String(text).length * 95) * mul);
            t = setTimeout(kill, dur);
        }
        el.addEventListener('click', (e) => { e.stopPropagation(); if (t) clearTimeout(t); kill(); });
    }
    function modulePanelBody(id) {
        const host = panelsHost(); if (!host) return null;
        let p = host.querySelector(`.svn-panel[data-mod="${id}"]`);
        if (!p) { p = document.createElement('div'); p.className = 'svn-panel'; p.dataset.mod = id; host.appendChild(p); }
        return p;
    }
    function renderModulePanel(def) {
        const host = panelsHost(); if (!host) return;
        const existing = host.querySelector(`.svn-panel[data-mod="${def.id}"]`);
        if (!getSettings().panels || !moduleEnabled(def.id)) { if (existing) existing.remove(); updatePanelsChrome(); return; }
        try { def.render && def.render(def._api); } catch (e) { console.warn('[VN] модуль', def.id, e); }
        updatePanelsChrome();
    }
    function engineOnOpen() {
        _loveReveal = false; // каждое открытие плеера — цифры снова скрыты
        const host = panelsHost(); if (host) host.innerHTML = '';
        if (getSettings().panels) {
            for (const def of MODULES) {
                if (!moduleEnabled(def.id)) continue;
                try { def.onOpen && def.onOpen(def._api); } catch (e) { /* ignore */ }
                renderModulePanel(def);
            }
        }
        updatePanelsChrome();
    }
    function engineOnFrame() {
        if (!player.open) return;
        for (const def of MODULES) {
            if (!moduleEnabled(def.id)) continue;
            try { def.onFrame && def.onFrame(def._api); } catch (e) { /* ignore */ }
        }
    }
    function engineOnTurn(mesId) {
        // ДЕДУП + ОТКАТ накопительных эффектов (искры/любовь/инвентарь).
        // CHARACTER_MESSAGE_RENDERED прилетает на ре-рендер, свайп туда-обратно и переоткрытие чата.
        //  • Дедуп: тот же (сообщение · свайп) повторно не применяем — иначе числа «надуваются».
        //  • Откат: у ПОСЛЕДНЕГО сообщения держим снапшот состояния «до его хода» и восстанавливаем
        //    его на каждом пере-свайпе, чтобы дельты нового свайпа не наслаивались на старый.
        //    (Свайп НЕ последнего сообщения чейн назад не пересчитывает — см. README/заметку.)
        const chat = getCtx().chat || [];
        const msg = chat[mesId] || {};
        const swipe = msg.swipe_id || 0;
        if (_turnApplied.get(mesId) === swipe) return; // этот свайп уже применён
        const isLatest = mesId >= chat.length - 1;
        const known = _turnApplied.has(mesId);
        if (isLatest) {
            if (known && _turnSnapshots.has(mesId)) restoreModuleState(_turnSnapshots.get(mesId)); // пере-свайп → откат
            else if (!known) { _turnSnapshots.clear(); _turnSnapshots.set(mesId, snapshotModuleState()); } // первый ход → база (нужен только снапшот последнего)
        }
        _turnApplied.set(mesId, swipe);
        _loveReveal = false; // новая сцена — скрытые цифры снова прячем (купи заново)
        _turnCoins = 0;      // обнуляем счётчик искр этого хода (для «Итога сцены»)
        for (const def of MODULES) {
            if (!moduleEnabled(def.id)) continue;
            try { def.onTurn && def.onTurn(def._api, mesId); } catch (e) { /* ignore */ }
        }
        if (player.open) for (const def of MODULES) if (moduleEnabled(def.id)) renderModulePanel(def);
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  МИНИ-ИИ РЕЖИССЁР                                               ║
    // ║  Читает ГОТОВЫЙ ответ основного ИИ и САМ детерминированно        ║
    // ║  ставит ровно N кадров-картинок (minImages..maxImages) + пишет   ║
    // ║  служебный <vn-status> для всех панелей-модулей + (опц.) набирает║
    // ║  плейлист под вайб. Основному ИИ при этом НЕ уходит НИКАКОЙ      ║
    // ║  инструкции про оформление — поэтому число кадров соблюдается    ║
    // ║  всегда, а не «если модель послушалась».                        ║
    // ╚════════════════════════════════════════════════════════════════╝
    const _directorDone = new Map(); // mesId -> swipe_id (этот ответ уже отрежиссирован)
    const _directorBusy = new Set(); // mesId (режиссёр сейчас работает — анти-дубль)
    const _selfEmit = new Set();     // mesId (наш повторный CHARACTER_MESSAGE_RENDERED ради генерации картинок — не режиссировать на нём)

    function frameRange() {
        const s = getSettings();
        const mx = Math.max(1, Math.min(10, parseInt(s.maxImages, 10) || 3));
        const mn = Math.max(1, Math.min(mx, parseInt(s.minImages, 10) || 1));
        return { mn, mx };
    }
    // собрать тег картинки в выбранном формате (iig / <image>) с учётом 16:9 и качества.
    // data-svn="1" — метка «это кадр от режиссёра» (чтобы чистить свои картинки во внешних блоках, не трогая чужие)
    function buildImageTag(prompt, idx) {
        const s = getSettings();
        const p = String(prompt || '').replace(/\s+/g, ' ').trim() || 'cinematic anime illustration of the current scene';
        if ((s.imgFormat || 'iig') === 'image') return `<image>${p.replace(/<\/?image>/gi, '')}</image>`;
        const land = s.forceLandscape !== false;
        const size = (s.imageSize === '2K' || s.imageSize === '4K') ? s.imageSize : '1K';
        const instr = JSON.stringify({ prompt: p, aspect_ratio: land ? '16:9' : '3:2', image_size: size }).replace(/'/g, '&#39;');
        // data-svn=индекс кадра — уникальная метка: расширение картинок меняет src по точному совпадению
        // строки тега, и два ОДИНАКОВЫХ промпта без уникальной метки слились бы в один (часть кадров не появлялась бы)
        return `<img data-svn="${idx != null ? idx : 0}" data-iig-instruction='${instr}' src="[IMG:GEN]">`;
    }
    // режим внешних блоков для картинок режиссёра: теги уходят в extra.extblocks, в .mes — плейсхолдеры.
    // только для формата iig (его читает/пишет расширение картинок в extblocks); 'image' остаётся inline.
    const IMG_PLACEHOLDER = '<!--svn-img-->';
    function directorToBlocks() {
        const s = getSettings();
        return s.extBlocksImages !== false && (s.imgFormat || 'iig') === 'iig';
    }
    // вписать теги картинок во внешние блоки сообщения (как это делает ExtBlocks: extra.extblocks + per-swipe)
    function extBlocksWriteImages(msg, tagsStr) {
        if (!tagsStr) return;
        if (!msg.extra) msg.extra = {};
        const clearSvn = (s) => String(s || '').replace(/\s*<img\b[^>]*data-svn[^>]*>/gi, '').trim(); // снять СВОИ прошлые кадры (анти-дубль на пере-режиссуре/свайпе), чужие блоки не трогаем
        const merge = (cur) => { const c = clearSvn(cur); return c ? c + '\n' + tagsStr : tagsStr; };
        msg.extra.extblocks = merge(msg.extra.extblocks);
        const sw = msg.swipe_id;
        if (sw != null) { // храним и в текущем свайпе, иначе при листании свайпов картинки потеряются
            if (!msg.swipe_info) msg.swipe_info = {};
            if (!msg.swipe_info[sw]) msg.swipe_info[sw] = { extra: {} };
            if (!msg.swipe_info[sw].extra) msg.swipe_info[sw].extra = {};
            msg.swipe_info[sw].extra.extblocks = merge(msg.swipe_info[sw].extra.extblocks);
        }
    }
    // границы предложений/абзацев (смещения СРАЗУ ПОСЛЕ конца предложения)
    function sentenceBoundaries(text) {
        const b = [];
        for (let i = 0; i < text.length - 1; i++) {
            const c = text[i];
            if (c === '.' || c === '!' || c === '?' || c === '…' || c === '\n') {
                let j = i + 1;
                while (j < text.length && '.!?…"»”\')]'.includes(text[j])) j++;
                while (j < text.length && (text[j] === ' ' || text[j] === '\n' || text[j] === '\t')) j++;
                if (j > 0 && j < text.length) b.push(j);
                i = j - 1;
            }
        }
        return b;
    }
    // N позиций для вставки кадров, равномерно по тексту; первая всегда 0 (общий план-фон)
    function computeInsertOffsets(text, n) {
        const offs = [0];
        if (n <= 1) return offs;
        const b = sentenceBoundaries(text);
        for (let k = 1; k < n; k++) {
            const target = k * text.length / n;
            if (!b.length) { offs.push(Math.round(target)); continue; }
            let best = b[0];
            for (const x of b) if (Math.abs(x - target) < Math.abs(best - target)) best = x;
            offs.push(best);
        }
        return offs;
    }
    // вставить строки (теги кадров ИЛИ плейсхолдеры) в прозу, сохранив исходный текст; в порядке повествования
    function injectInserts(text, inserts) {
        const n = inserts.length; if (!n) return text;
        const offs = computeInsertOffsets(text, n)
            .map(o => Math.max(0, Math.min(text.length, o)))
            .map((o, i) => ({ o, i }))
            .sort((a, b) => a.o - b.o);
        let out = text;
        // вставляем с конца, чтобы смещения не «плыли»; по возрастанию позиции = inserts[порядковый]
        for (let k = offs.length - 1; k >= 0; k--) {
            const pos = offs[k].o;
            out = out.slice(0, pos) + inserts[k] + '\n' + out.slice(pos);
        }
        return out;
    }
    // грубый запас БЕЗ мини-ИИ: делим прозу на куски — чтобы число кадров соблюдалось даже без лёгкого ИИ.
    // Каждый кадр получает СВОЙ тип плана (разные строки → разные картинки, а не дубли).
    const FALLBACK_SHOTS = ['wide establishing shot', 'medium shot', 'close-up portrait', 'over-the-shoulder shot', 'reaction close-up', 'wide cinematic shot'];
    function fallbackPrompts(msg, count, startIdx) {
        const vb = extractVnBlock(msg.mes); let prose = (vb == null) ? (msg.mes || '') : vb;
        prose = cleanText(stripMeta(prose)).replace(/\s+/g, ' ').trim();
        const words = prose.split(' ').filter(Boolean);
        const out = [];
        const chunk = Math.max(8, Math.ceil(words.length / Math.max(1, count)) || 8);
        for (let i = 0; i < count; i++) {
            const seg = words.slice(i * chunk, i * chunk + 26).join(' ');
            const base = seg || prose.slice(0, 140) || 'visual novel scene';
            const shot = FALLBACK_SHOTS[((startIdx || 0) + i) % FALLBACK_SHOTS.length];
            out.push(`${shot}: ${base}, cinematic anime illustration, soft cinematic lighting, highly detailed`);
        }
        return out;
    }
    function enforceFrameCount(prompts, mn, mx, msg) {
        let p = (prompts || []).map(x => String(x || '').trim()).filter(Boolean).slice(0, mx);
        if (p.length < mn) p = p.concat(fallbackPrompts(msg, mn - p.length, p.length)).slice(0, mx); // добиваем недостающие (с уникальным планом)
        while (p.length < mn) p.push(`${FALLBACK_SHOTS[p.length % FALLBACK_SHOTS.length]}: current visual novel scene, cinematic anime illustration, soft cinematic lighting`);
        return p;
    }
    // собрать тело <vn-status> из статуса, который вернул мини-ИИ (его потом читают модули-панели)
    function serializeStatus(st) {
        st = st || {};
        const lines = [];
        const put = (k, v) => { v = (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim(); if (v) lines.push(`${k}: ${v}`); };
        const pick = (...keys) => { for (const k of keys) if (st[k] != null && String(st[k]).trim() !== '') return st[k]; return ''; };
        if (moduleEnabled('scene')) { put('place', pick('place', 'место')); put('mood', pick('mood', 'настроение')); put('time', pick('time', 'время')); put('weather', pick('weather', 'погода')); }
        if (moduleEnabled('emotion')) put('emotion', pick('emotion', 'эмоция'));
        if (moduleEnabled('love')) {
            const sy = pick('symp', 'sympathy'), tr = pick('trust', 'доверие'), at = pick('attr', 'attraction', 'влечение');
            if (sy !== '') lines.push(`symp: ${clampDelta(sy)}`);
            if (tr !== '') lines.push(`trust: ${clampDelta(tr)}`);
            if (at !== '') lines.push(`attr: ${clampDelta(at)}`);
            put('reason', pick('reason', 'причина')); put('trait', pick('trait', 'черта'));
        }
        if (moduleEnabled('inventory')) put('item', pick('item', 'предмет', 'предметы'));
        if (moduleEnabled('journal')) { put('goal', pick('goal', 'цель', 'цели')); put('flag', pick('flag', 'флаг', 'событие')); }
        return lines.join('\n');
    }
    // ОДИН вызов мини-ИИ: разбивает сцену на кадры + заполняет статус + (опц.) спрайты/плейлист
    async function directorAsk(id, mn, mx) {
        const ctx = getCtx();
        const msg = (ctx.chat || [])[id];
        const vb = extractVnBlock(msg.mes); let prose = (vb == null) ? (msg.mes || '') : vb;
        prose = cleanText(stripMeta(prose)).replace(/[ \t]+/g, ' ').trim().slice(0, 4000);
        const want = (mn === mx) ? `ровно ${mx}` : `${mx} (если сцена совсем короткая — допустимо минимум ${mn}, но СТАРАЙСЯ дать все ${mx})`;
        const char = String(ctx.name2 || 'Персонаж'), user = String(ctx.name1 || 'Игрок');
        // поля статуса от включённых модулей (кроме bgm — музыку берём отдельным плейлистом)
        const statusFields = [];
        for (const m of MODULES) {
            if (m.id === 'bgm' || !moduleEnabled(m.id) || typeof m.statusFields !== 'function') continue;
            try { const f = m.statusFields(m._api); if (Array.isArray(f)) for (const x of f) if (x) statusFields.push(x); } catch (e) { /* ignore */ }
        }
        const cast = (typeof getCast === 'function') ? getCast() : [];
        const wantSprites = getSettings().spriteAuto !== false && cast.length > 0;
        // музыку добираем, только если плейлист ещё НЕ набран до целевого размера — иначе не дёргаем мини-ИИ зря
        const bgmGap = Math.max(0, bgmTarget() - bgmList().length);
        const wantPlaylist = moduleEnabled('bgm') && moduleCfg('bgm').auto !== false && bgmGap > 0;
        const plCount = Math.max(1, Math.min(8, bgmGap)); // за один ход добираем не больше 8 (чтобы JSON не пух)
        let n = 1;
        const sys =
`Ты — режиссёр визуальной новеллы. Тебе дают ГОТОВУЮ реплику ролевого ИИ — ты НЕ переписываешь её, а оформляешь как сцену:
1) СНАЧАЛА заполни массив "frames": разбей сцену на ${want} кадров-картинок — это ОБЯЗАТЕЛЬНО, ровно столько строк в массиве, не меньше и не больше. К каждому кадру — ОТДЕЛЬНЫЙ промпт НА АНГЛИЙСКОМ (60–110 слов): что и кто в кадре, поза и эмоция, ракурс, свет, окружение, атмосфера, стиль рисовки. Внешность КАЖДОГО персонажа держи КОНСИСТЕНТНОЙ. Первый кадр — общий план-фон сцены, дальше — ключевые моменты по ходу текста до самого конца реплики (последний кадр — по финалу сцены).
${statusFields.length ? `${n++}) Заполни объект "status" — только поля, что реально знаешь.\n` : ''}${wantSprites ? `${n++}) Расставь спрайты в массив "sprites".\n` : ''}${wantPlaylist ? `${n++}) Подбери "playlist" — ${plCount} РЕАЛЬНО существующих песен под вайб/настроение сцены ("Песня - Исполнитель"); главное — атмосфера, жанр любой.\n` : ''}Ответь СТРОГО ОДНИМ JSON-объектом, без markdown и пояснений. Ничего не пропускай в "frames".`;
        const usr =
`[Сцена: ${char}; игрок: ${user}]

[Реплику оформить]
${prose}

Верни JSON:
{
  "frames": [ ${want} строк-промптов НА АНГЛИЙСКОМ в порядке повествования ]${statusFields.length ? `,
  "status": { ${statusFields.map(f => '"' + String(f).split(':')[0].trim() + '"').join(', ')} }` : ''}${wantSprites ? `,
  "sprites": [ {"name": "имя из списка", "pos": "left|center|right", "emotion": "ключ эмоции"} ]` : ''}${wantPlaylist ? `,
  "playlist": [ ${plCount} строк "Песня - Исполнитель" ]` : ''}
}${statusFields.length ? `\n\nПоля status:\n${statusFields.join('\n')}` : ''}${wantSprites ? `\n\nПерсонажи для sprites (имя · позиция · эмоции):\n${castRosterText()}` : ''}`;
        // бюджет токенов масштабируем под число кадров (60–110 слов × N + статус/плейлист),
        // иначе на длинном посте JSON ОБРЕЗАЕТСЯ и часть кадров теряется → картинки «не появляются».
        const maxTokens = Math.min(2400, 500 + mx * 260 + (wantPlaylist ? plCount * 14 : 0));
        const raw = await askLite({ system: sys, user: usr, json: true, maxTokens });
        return directorParse(raw, mn);
    }
    // разбор ответа режиссёра + СПАСЕНИЕ кадров из обрезанного/кривого JSON (ключевое для длинных постов):
    // даже если ответ оборвался на "status"/"playlist", вытащим строки из массива "frames".
    function directorParse(raw, mn) {
        const data = parseLooseJson(raw) || {};
        const enough = Array.isArray(data.frames) && data.frames.filter(Boolean).length >= (mn || 1);
        if (!enough) {
            const fm = String(raw || '').match(/"frames"\s*:\s*\[([\s\S]*?)(?:\]|$)/i);
            if (fm) {
                const items = fm[1].match(/"((?:[^"\\]|\\.)*)"/g);
                if (items && items.length) data.frames = items.map(s => { try { return JSON.parse(s); } catch (e) { return s.replace(/^"|"$/g, ''); } });
            }
        }
        return data;
    }
    // применить результат режиссёра к сообщению: вписать кадры/спрайты/<vn-status>, перерисовать, запустить генерацию
    function applyDirectorResult(id, prompts, data) {
        const ctx = getCtx();
        const msg = (ctx.chat || [])[id]; if (!msg) return;
        const original = msg.mes || '';
        const vb = extractVnBlock(original); let prose = (vb == null) ? original : vb;
        prose = stripMeta(prose).replace(/<\/?vn>/gi, '');
        // <choices> (если основной ИИ его написал) идёт в КОНЦЕ — вынимаем, чтобы кадры не дробили его блок
        let choicesBlock = '';
        prose = prose.replace(/<choices\b[^>]*>[\s\S]*?<\/choices>/gi, (m) => { choicesBlock += (choicesBlock ? '\n' : '') + m; return ''; });
        prose = prose.replace(/<sprite\b[^>]*>/gi, '').trim(); // спрайты ставит режиссёр (ниже), дубли не нужны
        // спрайты-теги в начало (если каст задан и мини-ИИ их вернул)
        let head = '';
        if (data && Array.isArray(data.sprites)) {
            for (const sp of data.sprites.slice(0, 6)) {
                if (!sp || !sp.name) continue;
                const pos = ['left', 'center', 'right', 'farleft', 'farright'].includes(String(sp.pos || '').toLowerCase()) ? String(sp.pos).toLowerCase() : 'center';
                const emo = String(sp.emotion || sp.emo || '').replace(/[^0-9a-zа-яё _-]/gi, '').trim();
                head += `<sprite name="${escapeHtml(sp.name)}" pos="${pos}"${emo ? ` emotion="${escapeHtml(emo)}"` : ''}>\n`;
            }
        }
        const tags = prompts.map((p, i) => buildImageTag(p, i));
        const toBlocks = directorToBlocks();
        // в режиме внешних блоков в .mes идут плейсхолдеры, а реальные теги картинок — в extra.extblocks
        const inserts = toBlocks ? prompts.map(() => IMG_PLACEHOLDER) : tags;
        let inner = head + injectInserts(prose, inserts);
        if (choicesBlock) inner += '\n' + choicesBlock;
        const statusText = data ? serializeStatus(data.status || data) : '';
        let out = `<vn>\n${inner}\n</vn>`;
        if (statusText) out += `\n<vn-status>\n${statusText}\n</vn-status>`;
        if (!msg.extra) msg.extra = {};
        if (msg.extra.svn_orig == null) msg.extra.svn_orig = original; // оригинал на случай возврата
        msg.mes = out;
        if (Array.isArray(msg.swipes) && msg.swipe_id != null) msg.swipes[msg.swipe_id] = out; // сохранить в активный свайп
        if (toBlocks) extBlocksWriteImages(msg, tags.join('\n')); // картинки — во внешние блоки (их сгенерит расширение картинок с «Process external blocks»)
        _directorDone.set(id, msg.swipe_id || 0); // ставим ДО ре-эмита, чтобы не зайти на второй круг
        _sceneCache.delete(id);
        // музыка-плейлист под вайб
        if (data && Array.isArray(data.playlist) && data.playlist.length) { try { bgmFromDirector(data.playlist); } catch (e) { /* ignore */ } }
        // перерисовать DOM .mes_text, чтобы расширение картинок увидело свежие теги [IMG:GEN]
        try { if (typeof ctx.updateMessageBlock === 'function') ctx.updateMessageBlock(id, msg); } catch (e) { /* ignore */ }
        try { ctx.saveChat && ctx.saveChat(); } catch (e) { /* ignore */ }
        retriggerImageExtension(id); // запустить генерацию вставленных кадров
        afterDirector(id);           // показать карточку/плеер + прогнать модули-панели
    }
    // запустить генерацию вставленных кадров в расширении картинок
    function retriggerImageExtension(id) {
        const mes = getMesEl(id);
        // 1) хирургично: кнопка «перегенерировать картинки» расширения (megarakk/sillyimages) — без глобальных событий
        const btn = mes && (mes.querySelector('.iig-regenerate-btn') || mes.querySelector('.iig-regen-all-btn'));
        if (btn) { try { btn.click(); return; } catch (e) { /* ignore */ } }
        // 2) обобщённо: повторно эмитим событие рендера — его слушает любое расширение картинок (megarakk = makeLast)
        const ctx = getCtx(); const E = ctx.event_types || {};
        if (E.CHARACTER_MESSAGE_RENDERED && ctx.eventSource && typeof ctx.eventSource.emit === 'function') {
            _selfEmit.add(id);
            // снимаем флаг по таймеру (а не по промису emit): генерация картинок в расширении может идти
            // десятки секунд, а наш собственный хэндлер отрабатывает синхронно в самом начале emit.
            setTimeout(() => _selfEmit.delete(id), 1500);
            try { ctx.eventSource.emit(E.CHARACTER_MESSAGE_RENDERED, id); } catch (e) { _selfEmit.delete(id); }
        }
    }
    // хвост обработки: карточка + (если ждали/автооткрытие) плеер + модули-панели
    function afterDirector(id) {
        const s = getSettings();
        decorateMessage(id);
        if (!isVnMessage(id)) return;
        engineOnTurn(id);
        if (player.open && player.waiting) {
            player.waiting = false;
            const st = player.el.querySelector('#svn-status'); if (st) st.classList.remove('svn-show');
            const wasAuto = player.autoPlay; openPlayer(id); player.autoPlay = wasAuto; updateAutoBtn(); scheduleAuto();
        } else if (s.autoOpen && !player.open) openPlayer(id);
    }
    // временная плашка «мини-ИИ собирает кадры…», пока режиссёр думает (без неё пользователь видит сырой текст)
    function markDirecting(id) {
        const mes = getMesEl(id); if (!mes) return;
        mes.classList.add('svn-directing');
        if (!getSettings().hideMarkup) return;
        mes.classList.add('svn-active');
        const block = mes.querySelector('.mes_block') || mes;
        if (block.querySelector('.svn-card')) return;
        const card = document.createElement('div');
        card.className = 'svn-card svn-card-directing';
        card.innerHTML = `<span class="svn-card-scrim"></span><span class="svn-card-type"><i class="fa-solid fa-clapperboard"></i> Визуальная новелла</span><div class="svn-card-main"><div class="svn-card-title"><span class="svn-spin"></span> собираю кадры…</div><div class="svn-card-sub">мини-ИИ режиссирует сцену</div></div>`;
        const mesText = block.querySelector('.mes_text');
        if (mesText) mesText.insertAdjacentElement('afterend', card); else block.insertBefore(card, block.firstChild);
    }
    async function runDirector(id) {
        const ctx = getCtx();
        const msg = (ctx.chat || [])[id];
        if (!msg || msg.is_user) return;
        const swipe = msg.swipe_id || 0;
        if (_directorDone.get(id) === swipe || _directorBusy.has(id)) return;
        if (hasImageTags(msgSource(msg))) { _directorDone.set(id, swipe); afterDirector(id); return; } // уже есть свои картинки — не трогаем
        _directorBusy.add(id);
        markDirecting(id);
        try {
            const { mn, mx } = frameRange();
            let prompts = [];
            try {
                const data = await directorAsk(id, mn, mx);
                prompts = (data && Array.isArray(data.frames)) ? data.frames.map(f => (typeof f === 'string' ? f : (f && f.prompt) || '')) : [];
                prompts = enforceFrameCount(prompts, mn, mx, msg);
                applyDirectorResult(id, prompts, data || {});
                directorSummary(data || {}, prompts.length); // показать, что реально вернул мини-ИИ (для проверки)
            } catch (e) {
                console.warn('[VN] режиссёр (мини-ИИ) не ответил, ставлю кадры запасным способом:', e);
                notifyLiteFail(e, 'Режиссёр не ответил — кадры ставлю из текста, но статус/музыка не заполнены. Проверь эндпоинт (кнопка «Проверить связь») или возьми модель поумнее / верни мини-ИИ на «таверну».');
                applyDirectorResult(id, enforceFrameCount([], mx, mx, msg), {}); // эндпоинт мёртв — даём МАКС кадров из прозы (юзер хочет «много»), «функция точно работает» даже без лёгкого ИИ
            }
        } finally {
            _directorBusy.delete(id);
        }
    }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  МУЗЫКА (BGM)                                                   ║
    // ║  Поиск/проигрывание через бесплатные музыкальные API — те же,   ║
    // ║  что в «酒馆助手 Music Player» (GDStudio/VKeys/Meting): они       ║
    // ║  отдают реальную ссылку-стрим, поэтому музыка ТОЧНО играет.      ║
    // ║  Источник трека на сцену задаёт основной ИИ полем music: в       ║
    // ║  <vn-status>; плейлист (per-chat) виден в листе «Музыка».        ║
    // ╚════════════════════════════════════════════════════════════════╝
    const BGM_APIS = [
        { id: 'netease-gd', name: 'NetEase (GDStudio)', searchUrl: 'https://music-api.gdstudio.xyz/api.php?types=search&count=5&source=netease&name={{query}}', getUrlApi: 'https://music-api.gdstudio.xyz/api.php?types=url&source=netease&id={{id}}', searchPath: '', idPath: 'id', namePath: 'name', artistPath: 'artist', urlPath: 'url' },
        { id: 'qq-vkeys', name: 'QQ (VKeys)', searchUrl: 'https://api.vkeys.cn/v2/music/tencent?word={{query}}', getUrlApi: 'https://api.vkeys.cn/v2/music/tencent?id={{id}}', searchPath: 'data', idPath: 'id', namePath: 'song', artistPath: 'singer', urlPath: 'data.url' },
        { id: 'netease-vkeys', name: 'NetEase (VKeys)', searchUrl: 'https://api.vkeys.cn/v2/music/netease?word={{query}}', getUrlApi: 'https://api.vkeys.cn/v2/music/netease?id={{id}}', searchPath: 'data', idPath: 'id', namePath: 'song', artistPath: 'singer', urlPath: 'data.url' },
        { id: 'kugou-meto', name: 'Kugou (Meto)', searchUrl: 'https://api.i-meto.com/meting/api?server=kugou&type=search&id={{query}}', getUrlApi: 'https://api.i-meto.com/meting/api?server=kugou&type=song&id={{id}}', searchPath: '', idPath: 'id', namePath: 'name', artistPath: 'artist', urlPath: '[0].url' },
    ];
    // путь по объекту с поддержкой "data.url" и "[0].url" (как P() в EBP)
    function bgmPath(o, p) {
        if (!p) return o;
        if (p.startsWith('[')) { const m = p.match(/^\[(\d+)\]\.?(.*)$/); if (m && Array.isArray(o)) return m[2] ? bgmPath(o[+m[1]], m[2]) : o[+m[1]]; }
        let c = o; for (const k of p.split('.')) { if (c == null) return undefined; c = c[k]; } return c;
    }
    const bgm = { audio: null, idx: -1, track: null, playing: false, mode: 0, vol: 0.7, lastQuery: '', results: [] };
    function bgmState() { const all = allModuleState(); if (!all.bgm || typeof all.bgm !== 'object') all.bgm = {}; if (!Array.isArray(all.bgm.playlist)) all.bgm.playlist = []; return all.bgm; }
    function bgmList() { return bgmState().playlist; }
    // целевой размер плейлиста: режиссёр КОПИТ треки до него, потом перестаёт добирать (старые не теряются)
    function bgmTarget() { return Math.max(1, Math.min(30, parseInt(getSettings().bgmPlaylistCount, 10) || 5)); }
    function bgmFmt(s) { return isNaN(s) ? '0:00' : Math.floor(s / 60) + ':' + Math.floor(s % 60).toString().padStart(2, '0'); }
    function bgmEnsureAudio() {
        if (bgm.audio) return bgm.audio;
        const cfg = moduleCfg('bgm');
        bgm.vol = (typeof cfg.vol === 'number') ? cfg.vol : 0.7;
        bgm.mode = cfg.mode || 0;
        const a = new Audio(); bgm.audio = a; a.volume = bgm.vol;
        a.addEventListener('ended', () => { if (bgm.mode === 2) { a.currentTime = 0; a.play().catch(() => {}); } else bgmNext(); });
        a.addEventListener('timeupdate', bgmProgress);
        a.addEventListener('loadedmetadata', bgmProgress);
        return a;
    }
    function bgmProgress() {
        const ov = player.el, a = bgm.audio; if (!ov || !a) return;
        const fill = ov.querySelector('#svn-bgm-fill'), tc = ov.querySelector('#svn-bgm-tc'), td = ov.querySelector('#svn-bgm-td');
        if (fill) fill.style.width = (a.duration ? (a.currentTime / a.duration * 100) : 0) + '%';
        if (tc) tc.textContent = bgmFmt(a.currentTime);
        if (td) td.textContent = bgmFmt(a.duration);
    }
    async function bgmSearch(query) {
        const out = [];
        for (const api of BGM_APIS) {
            try {
                const res = await fetch(api.searchUrl.replace('{{query}}', encodeURIComponent(query)));
                const json = await res.json();
                const data = api.searchPath ? bgmPath(json, api.searchPath) : json;
                const items = Array.isArray(data) ? data : (data ? [data] : []);
                for (const it of items.slice(0, 5)) {
                    const sid = bgmPath(it, api.idPath); if (!sid) continue;
                    const name = bgmPath(it, api.namePath) || '';
                    const ar = bgmPath(it, api.artistPath); const artist = Array.isArray(ar) ? ar.join(', ') : (ar || '');
                    out.push({ name, artist, full: artist ? name + ' - ' + artist : name, _apiId: api.id, _songId: String(sid) });
                }
            } catch (e) { /* пропускаем недоступный API */ }
        }
        return out;
    }
    async function bgmGetUrl(apiId, songId) {
        const api = BGM_APIS.find(a => a.id === apiId); if (!api) return null;
        try { const r = await fetch(api.getUrlApi.replace('{{id}}', songId)); return bgmPath(await r.json(), api.urlPath); } catch (e) { return null; }
    }
    function bgmTestUrl(url) {
        return new Promise(res => {
            if (!url) { res(false); return; }
            const t = new Audio(); t.preload = 'metadata';
            const done = v => { t.onloadedmetadata = t.onerror = null; t.src = ''; res(v); };
            t.onloadedmetadata = () => done(true); t.onerror = () => done(false); t.src = url;
            setTimeout(() => done(false), 6000);
        });
    }
    async function bgmResolveUrl(track) {
        if (track._apiId && track._songId) { const u = await bgmGetUrl(track._apiId, track._songId); if (u && await bgmTestUrl(u)) return u; }
        const q = track.full || track.name;
        for (const api of BGM_APIS) {
            try {
                const r = await fetch(api.searchUrl.replace('{{query}}', encodeURIComponent(q)));
                const j = await r.json(); const d = api.searchPath ? bgmPath(j, api.searchPath) : j;
                const items = Array.isArray(d) ? d : (d ? [d] : []);
                for (const it of items.slice(0, 3)) {
                    const sid = bgmPath(it, api.idPath); if (!sid) continue;
                    const u = await bgmGetUrl(api.id, String(sid));
                    if (u && await bgmTestUrl(u)) { track._apiId = api.id; track._songId = String(sid); return u; }
                }
            } catch (e) { /* next */ }
        }
        return null;
    }
    async function bgmPlay(track, idx) {
        if (!track) return;
        bgmEnsureAudio();
        bgm.track = track; bgm.idx = (idx != null && idx >= 0) ? idx : bgmList().indexOf(track);
        bgmRefreshUI();
        const url = await bgmResolveUrl(track);
        if (!url) { try { toastr && toastr.warning('Трек не найден: ' + (track.full || track.name), 'VN · Музыка'); } catch (e) { /* ignore */ } return; }
        if (bgm.track !== track) return; // успели переключить — не перебиваем
        bgm.audio.src = url; bgm.audio.volume = bgm.vol; bgm.audio.play().catch(() => {}); bgm.playing = true;
        bgmRefreshUI();
    }
    function bgmToggle() {
        bgmEnsureAudio();
        const l = bgmList();
        if (!bgm.track && l.length) { bgmPlay(l[0], 0); return; }
        if (!bgm.track) { try { toastr && toastr.info('Плейлист пуст', 'VN · Музыка'); } catch (e) { /* ignore */ } return; }
        if (bgm.playing) { bgm.audio.pause(); bgm.playing = false; } else { bgm.audio.play().catch(() => {}); bgm.playing = true; }
        bgmRefreshUI();
    }
    function bgmNext() { const l = bgmList(); if (!l.length) return; if (bgm.mode === 1) { bgmPlay(l[Math.floor(Math.random() * l.length)]); return; } const n = (bgm.idx + 1) % l.length; bgmPlay(l[n], n); }
    function bgmPrev() { const l = bgmList(); if (!l.length) return; const n = (bgm.idx - 1 + l.length) % l.length; bgmPlay(l[n], n); }
    function bgmAdd(track, autoplay) {
        const l = bgmList();
        const exist = l.findIndex(t => t.name === track.name && t.artist === track.artist);
        if (exist >= 0) { if (autoplay) bgmPlay(l[exist], exist); return; }
        l.push(track); saveSettings();
        if (autoplay) bgmPlay(track, l.length - 1); else { bgmRefreshUI(); try { toastr && toastr.success(track.name, 'VN · Музыка'); } catch (e) { /* ignore */ } }
    }
    function bgmRemove(idx) {
        const l = bgmList(); const was = bgm.idx === idx;
        l.splice(idx, 1); saveSettings();
        if (was) { if (l.length) { bgm.idx = Math.min(idx, l.length - 1); bgmPlay(l[bgm.idx], bgm.idx); } else { if (bgm.audio) bgm.audio.pause(); bgm.track = null; bgm.playing = false; bgm.idx = -1; } }
        else if (bgm.idx > idx) bgm.idx--;
        bgmRefreshUI();
    }
    function bgmSetVol(v) { bgm.vol = v; if (bgm.audio) bgm.audio.volume = v; moduleCfg('bgm').vol = v; saveSettings(); }
    const BGM_MODE_IC = ['fa-repeat', 'fa-shuffle', 'fa-repeat'], BGM_MODE_T = ['Повтор плейлиста', 'Случайно', 'Один трек'];
    function bgmCycleMode() { bgm.mode = (bgm.mode + 1) % 3; moduleCfg('bgm').mode = bgm.mode; saveSettings(); bgmRefreshUI(); }
    // музыка по сцене: основной ИИ кладёт music: в <vn-status>
    function bgmFromScene(api, mesId) {
        if (moduleCfg('bgm').auto === false) return;
        const q = (api.parseStatus(mesId).music || '').trim();
        if (!q || q.toLowerCase() === (bgm.lastQuery || '').toLowerCase()) return;
        bgm.lastQuery = q;
        bgmEnsureAudio();
        bgmSearch(q).then(res => { if (res.length) bgmAdd(res[0], true); });
    }
    // плейлист под вайб от мини-ИИ-режиссёра: ДОБАВЛЯЕТ новые треки к уже накопленным (не затирает!),
    // копит до bgmTarget() и больше не добирает — старые песни остаются, плейлист только растёт.
    function bgmFromDirector(songs) {
        if (moduleCfg('bgm').auto === false) return;
        const list = (songs || []).map(x => String(x || '').trim()).filter(Boolean).slice(0, 12);
        if (!list.length) return;
        const target = bgmTarget();
        if (bgmList().length >= target) return; // плейлист уже набран — ничего не трогаем (треки на месте)
        const sig = list.join('|').toLowerCase();
        if (sig === (bgm.lastQuery || '').toLowerCase()) return; // тот же набор названий — не ищем повторно
        bgm.lastQuery = sig;
        bgmEnsureAudio();
        (async () => {
            const found = [];
            for (const q of list) {
                try { const res = await bgmSearch(q); if (res && res.length) found.push(res[0]); } catch (e) { /* пропускаем ненайденное */ }
            }
            if (!found.length) return;
            const st = bgmState();
            const before = st.playlist.length;
            for (const t of found) {
                if (st.playlist.length >= target) break;                                          // не превышаем целевой размер
                if (st.playlist.some(x => x.name === t.name && x.artist === t.artist)) continue;   // дубликаты не копим
                st.playlist.push(t);                                                              // ← ДОБАВЛЯЕМ к старым
            }
            if (st.playlist.length === before) { bgmRefreshUI(); return; } // ничего нового не добавилось
            saveSettings();
            // играем дальше как было: индексы старых треков не сдвинулись (мы только дописали в конец).
            // если ничего не играло — стартуем с первого ДОБАВЛЕННОГО трека (вайб новой сцены).
            if (bgm.playing && bgm.track) bgmRefreshUI();
            else { bgm.idx = -1; bgmPlay(st.playlist[before], before); bgmRefreshUI(); }
        })();
    }
    function bgmRefreshUI() {
        const def = MODULES.find(m => m.id === 'bgm'); if (def && player.open) renderModulePanel(def);
        bgmRenderNow(); bgmRenderPlaylist();
    }
    function bgmRenderNow() {
        const ov = player.el; if (!ov) return; const now = ov.querySelector('#svn-bgm-now'); if (!now) return;
        const t = bgm.track;
        const nm = now.querySelector('#svn-bgm-name'); if (nm) nm.textContent = t ? t.name : 'Нет трека';
        const ar = now.querySelector('#svn-bgm-artist'); if (ar) ar.textContent = t ? (t.artist || '') : '';
        const pb = now.querySelector('[data-bgm="toggle"] i'); if (pb) pb.className = 'fa-solid ' + (bgm.playing ? 'fa-pause' : 'fa-play');
        const md = now.querySelector('[data-bgm="mode"]'); if (md) { md.title = BGM_MODE_T[bgm.mode]; md.classList.toggle('svn-ib-active', bgm.mode !== 0); const mi = md.querySelector('i'); if (mi) mi.className = 'fa-solid ' + BGM_MODE_IC[bgm.mode]; }
        const vol = now.querySelector('#svn-bgm-vol'); if (vol && document.activeElement !== vol) vol.value = bgm.vol;
    }
    function bgmRenderPlaylist() {
        const ov = player.el; if (!ov) return; const list = ov.querySelector('#svn-bgm-list'); if (!list) return;
        const l = bgmList();
        if (!l.length) { list.innerHTML = '<div class="svn-bgm-empty">Плейлист пуст. Найди трек выше или включи подбор по сцене (ИИ задаёт музыку сам).</div>'; return; }
        list.innerHTML = l.map((t, i) => {
            const cur = bgm.track && t.name === bgm.track.name && t.artist === bgm.track.artist;
            return `<div class="svn-bgm-row${cur ? ' svn-bgm-cur' : ''}" data-i="${i}"><span class="svn-bgm-row-i"><i class="fa-solid ${cur && bgm.playing ? 'fa-volume-high' : 'fa-music'}"></i></span><span class="svn-bgm-row-t"><span class="svn-bgm-row-n">${escapeHtml(t.name)}</span>${t.artist ? `<span class="svn-bgm-row-a">${escapeHtml(t.artist)}</span>` : ''}</span><button class="svn-bgm-row-x" data-del="${i}" title="Убрать"><i class="fa-solid fa-xmark"></i></button></div>`;
        }).join('');
    }
    function bgmRenderResults(res) {
        const ov = player.el; if (!ov) return; const box = ov.querySelector('#svn-bgm-results'); if (!box) return;
        bgm.results = res || [];
        if (!res || !res.length) { box.innerHTML = '<div class="svn-bgm-empty">Ничего не найдено</div>'; return; }
        box.innerHTML = res.map((t, i) => `<div class="svn-bgm-sr"><span class="svn-bgm-sr-t"><span class="svn-bgm-row-n">${escapeHtml(t.name)}</span>${t.artist ? `<span class="svn-bgm-row-a">${escapeHtml(t.artist)}</span>` : ''}</span><button class="svn-bgm-sr-b" data-play="${i}" title="Слушать"><i class="fa-solid fa-play"></i></button><button class="svn-bgm-sr-b" data-add="${i}" title="В плейлист"><i class="fa-solid fa-plus"></i></button></div>`).join('');
    }
    function openBgmSheet() { const ov = player.el; if (!ov) return; bgmEnsureAudio(); ov.querySelector('#svn-bgm').classList.add('svn-show'); bgmRenderNow(); bgmRenderPlaylist(); }
    function closeBgmSheet() { player.el && player.el.querySelector('#svn-bgm').classList.remove('svn-show'); }

    // ╔════════════════════════════════════════════════════════════════╗
    // ║  БЭКЛОГ (история реплик) — прокручиваемый журнал всех реплик     ║
    // ║  сцен чата; клик по строке — прыжок к этой реплике.              ║
    // ╚════════════════════════════════════════════════════════════════╝
    function collectBacklog() {
        const ctx = getCtx(); const chat = ctx.chat || []; const out = [];
        for (let i = 0; i < chat.length; i++) {
            if (!chat[i] || chat[i].is_user) continue;
            const scene = parseSceneCached(i); if (!scene) continue; // null → не VN-сообщение
            scene.frames.forEach((f, fi) => {
                if (!f.text) return;
                let spk = '';
                if (f.active && f.cast && f.cast[f.active]) {
                    const a = findActorByKey(f.active);
                    spk = a ? displayActorName(a) : (f.cast[f.active].name || '');
                    if (/\{\{\s*user\s*\}\}/i.test(spk)) spk = String(ctx.name1 || 'Ты');
                }
                out.push({ mesId: i, frameIdx: fi, speaker: spk, text: f.text });
            });
        }
        return out;
    }
    function openBacklog() {
        const ov = player.el; if (!ov) return; const sheet = ov.querySelector('#svn-backlog'); if (!sheet) return;
        const body = sheet.querySelector('#svn-backlog-body');
        const items = collectBacklog();
        const start = Math.max(0, items.length - 600);
        const slice = items.slice(start);
        body.innerHTML = slice.length ? slice.map((it) => {
            const cur = (it.mesId === player.mesId && it.frameIdx === player.frame);
            const seen = isSeen(it.mesId, it.frameIdx);
            const cls = 'svn-bl-row' + (cur ? ' svn-bl-cur' : '') + (seen ? ' svn-bl-seen' : ' svn-bl-new');
            return `<button class="${cls}" data-mes="${it.mesId}" data-frame="${it.frameIdx}">${it.speaker ? `<span class="svn-bl-spk">${escapeHtml(it.speaker)}</span>` : ''}<span class="svn-bl-txt">${escapeHtml(it.text)}</span></button>`;
        }).join('') : '<div class="svn-bgm-empty">История пуста</div>';
        sheet.classList.add('svn-show');
        const cur = body.querySelector('.svn-bl-cur') || body.lastElementChild;
        if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
        updateBacklogToLast();
    }
    // кнопка «к последней реплике»: видна, когда бэклог прокручен вверх от низа
    // (скроллится сам лист #svn-backlog, а не его тело)
    function updateBacklogToLast() {
        const ov = player.el; if (!ov) return;
        const sheet = ov.querySelector('#svn-backlog');
        const btn = ov.querySelector('#svn-bl-tolast'); if (!sheet || !btn) return;
        const dist = sheet.scrollHeight - sheet.scrollTop - sheet.clientHeight;
        btn.classList.toggle('svn-show', dist > 90);
    }
    function backlogToLast() {
        const ov = player.el; if (!ov) return;
        const sheet = ov.querySelector('#svn-backlog'); if (!sheet) return;
        sheet.scrollTo({ top: sheet.scrollHeight, behavior: 'smooth' });
    }
    function closeBacklog() { player.el && player.el.querySelector('#svn-backlog').classList.remove('svn-show'); }
    function toggleBacklog() { const s = player.el && player.el.querySelector('#svn-backlog'); if (!s) return; if (s.classList.contains('svn-show')) closeBacklog(); else openBacklog(); }
    function backlogJump(mesId, frameIdx) {
        closeBacklog();
        if (player.mesId !== mesId) openPlayer(mesId);
        if (!player.scene) return;
        player.frame = Math.max(0, Math.min(frameIdx, player.scene.frames.length - 1));
        renderFrame();
    }

    // ── CG-галерея: все сгенерированные кадры чата ────────────────────
    function collectGallery() {
        const ctx = getCtx(); const chat = ctx.chat || []; const out = [];
        for (let i = 0; i < chat.length; i++) {
            if (!chat[i] || chat[i].is_user) continue;
            const scene = parseSceneCached(i); if (!scene || !scene.slots.length) continue; // null → не VN-сообщение
            const urls = resolveImageUrls(i, scene.slots.length);
            urls.forEach((u, slot) => { if (u) out.push({ mesId: i, url: u, slot }); });
        }
        return out;
    }
    function openGallery() {
        const ov = player.el; if (!ov) return; const sheet = ov.querySelector('#svn-gallery'); if (!sheet) return;
        const grid = sheet.querySelector('#svn-gallery-grid');
        const items = collectGallery();
        grid.innerHTML = items.length
            ? items.map(it => `<button class="svn-gal-item" data-mes="${it.mesId}" data-slot="${it.slot}" style="background-image:url('${cssUrl(it.url)}')"></button>`).join('')
            : '<div class="svn-bgm-empty">Пока нет кадров — появятся по мере генерации картинок.</div>';
        sheet.classList.add('svn-show');
    }
    function closeGallery() { player.el && player.el.querySelector('#svn-gallery').classList.remove('svn-show'); }
    function toggleGallery() { const s = player.el && player.el.querySelector('#svn-gallery'); if (!s) return; if (s.classList.contains('svn-show')) closeGallery(); else openGallery(); }
    function galleryJump(mesId, slot) {
        closeGallery();
        if (player.mesId !== mesId) openPlayer(mesId);
        if (!player.scene) return;
        let fi = player.scene.frames.findIndex(f => f.imageIndex === slot); if (fi < 0) fi = 0;
        player.frame = fi; renderFrame();
    }

    // ── ВСТРОЕННЫЕ МОДУЛИ ──────────────────────────────────────────────
    // Демо-модуль «Сцена»: доказывает весь конвейер (липкое состояние +
    // лёгкий ИИ + панель). Выключен по умолчанию. Дальше так же лягут
    // love-score, выборы, инфоблок/гардероб и т.д.
    function registerBuiltinModules() {
        registerModule({
            id: 'scene',
            name: 'Сцена (часы)',
            desc: 'Мини-HUD: время · место · погода · настроение. Заполняется из <vn-status> в ответе; без него — дочитывает мини-ИИ.',
            defaultOn: false,
            // поля, которые основной ИИ кладёт в общий <vn-status>
            statusFields() {
                return [
                    'place: где сейчас происходит сцена (1–3 слова)',
                    'mood: общее настроение сцены (1–3 слова)',
                    'time: время суток (утро/день/вечер/ночь)',
                    'weather: погода 1–2 слова — необязательно',
                ];
            },
            // данные из тега идемпотентны → обновляем и при открытии (в т.ч. при переходе к старой сцене)
            onOpen(api) { sceneFromStatus(api, player.mesId); },
            onTurn(api, mesId) {
                if (sceneFromStatus(api, mesId)) return; // тег есть — лёгкий ИИ не дёргаем
                // запас: лёгкий ИИ дочитывает сцену
                const sys = 'Ты — трекер сцены визуальной новеллы. По диалогу определи ТЕКУЩИЕ время суток, место и общее настроение сцены. Ответь СТРОГО одним JSON-объектом без пояснений: {"time":"...","place":"...","mood":"..."} на русском, коротко (1–3 слова на поле). Неизвестное — пустая строка.';
                const prev = api.getState();
                const user = api.recentTurns(getSettings().liteCtxTurns || 4)
                    + (prev ? `\n\n[Прошлое состояние сцены: ${JSON.stringify(prev)} — продолжай его, меняй только то, что реально изменилось]` : '');
                api.ask({ system: sys, user, json: true, maxTokens: 120 }).then(d => {
                    if (d && typeof d === 'object') api.setState({ time: d.time || '', place: d.place || '', mood: d.mood || '', weather: (api.getState() || {}).weather || '' });
                });
            },
            render(api) {
                const body = api.panelBody(); if (!body) return;
                const st = api.getState();
                if (!st || !(st.time || st.place || st.mood || st.weather)) {
                    body.innerHTML = _liteError.get('scene')
                        ? liteErrorChip('scene', 'не вышло прочитать сцену')
                        : `<div class="svn-pan-chip svn-pan-muted"><span class="svn-spin"></span> читаю сцену…</div>`;
                    bindLiteRetry(body);
                    return;
                }
                const bit = (ic, v) => v ? `<span class="svn-pan-bit"><i class="fa-solid ${ic}"></i> ${escapeHtml(v)}</span>` : '';
                body.innerHTML = `<div class="svn-pan-chip">${bit('fa-clock', st.time)}${bit('fa-location-dot', st.place)}${bit('fa-cloud-sun', st.weather)}${bit('fa-masks-theater', st.mood)}</div>`;
            },
        });

        // ── love-score / отношения (à la Клуб романтики) ──────────────
        registerModule({
            id: 'love',
            name: 'Любовь / отношения',
            desc: 'Симпатия · доверие · влечение: всплывашки, стадии, черты. Оценка из <vn-status>; без него — судит мини-ИИ.',
            defaultOn: false,
            statusFields() {
                return [
                    'symp: насколько ПОСЛЕДНЯЯ реплика игрока изменила симпатию персонажа — целое -10..10 (0 = без изменений; крупные сдвиги только на сильных моментах)',
                    'trust: так же изменение доверия, -10..10',
                    'attr: так же изменение влечения, -10..10',
                    'reason: короткая фраза-наблюдение НА РУССКОМ, почему так («ей понравилась твоя дерзость», «его насторожил холод»); пусто, если ничего не изменилось',
                    'trait: одно слово-черта, которую персонаж отметил в игроке этой репликой (дерзкий/заботливый/лживый…), или пусто',
                ];
            },
            onTurn(api, mesId) {
                const st = api.parseStatus(mesId);
                if (st.hasStatus && (st.symp != null || st.trust != null || st.attr != null || st.reason || st.trait)) {
                    applyLoveDeltas(api, st.symp || 0, st.trust || 0, st.attr || 0, st.reason, st.trait);
                    return; // тег есть — лёгкий ИИ не дёргаем
                }
                loveEvaluate(api); // запас: лёгкий ИИ
            },
            render(api) {
                const body = api.panelBody(); if (!body) return;
                const name = escapeHtml(api.charName());
                const st = api.getState();
                if (!st) {
                    const wait = _liteError.get('love')
                        ? liteErrorChip('love', 'не вышло оценить отношения')
                        : `<div class="svn-love-wait"><span class="svn-spin"></span> отношения ещё не считаны</div>`;
                    body.innerHTML = `<div class="svn-love"><div class="svn-love-hd"><span><i class="fa-solid fa-heart"></i> ${name}</span></div>${wait}</div>`;
                    bindLiteRetry(body);
                    return;
                }
                const pips = (v, cls) => {
                    const neg = v < 0, n = Math.max(0, Math.min(5, Math.round(Math.abs(v) / 20)));
                    let s = '';
                    for (let i = 0; i < 5; i++) s += `<span class="svn-pip${i < n ? (neg ? ' svn-pip-neg' : ' svn-pip-' + cls) : ''}"></span>`;
                    return s;
                };
                const axis = (ic, cls, v) => `<div class="svn-love-axis"><i class="fa-solid ${ic}"></i><span class="svn-pips">${pips(v, cls)}</span>${_loveReveal ? `<span class="svn-love-num">${v}</span>` : ''}</div>`;
                const traits = (st.traits && st.traits.length) ? `<div class="svn-love-traits">${st.traits.map(t => `<span class="svn-love-chip">${escapeHtml(t)}</span>`).join('')}</div>` : '';
                body.innerHTML =
`<div class="svn-love svn-love-compact">
  <div class="svn-love-hd"><span><i class="fa-solid fa-heart"></i> ${name}</span><span class="svn-love-stage">${escapeHtml(st.stage || '')}</span></div>
  <div class="svn-love-meters">
    ${axis('fa-heart', 'love', st.symp)}
    ${axis('fa-handshake-simple', 'trust', st.trust)}
    ${axis('fa-fire', 'attr', st.attr)}
  </div>
  ${traits}
  <button class="svn-love-redo" title="Сбросить отношения"><i class="fa-solid fa-rotate-left"></i></button>
</div>`;
                const rb = body.querySelector('.svn-love-redo');
                if (rb) rb.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('Сбросить отношения с этим персонажем?')) api.setState(newLove()); });
            },
        });

        // ── валюта «искры»: зарабатывается игрой, тратится на дерзкие выборы ──
        registerModule({
            id: 'currency',
            name: 'Искры (валюта)',
            desc: 'Зарабатываются игрой: за ход и за тёплые моменты в отношениях. Тратятся на дерзкие выборы, намёк от персонажа (💡) и показ скрытых цифр отношений (👁).',
            defaultOn: false,
            onTurn() { addCoins(1); },
            render(api) {
                const body = api.panelBody(); if (!body) return;
                const amount = (api.getState() || { amount: 0 }).amount || 0;
                const HINT = 3, PEEK = 2;
                const peekBtn = moduleEnabled('love')
                    ? `<button class="svn-coin-btn" data-act="peek"${amount < PEEK ? ' disabled' : ''} title="Открыть скрытые цифры отношений за ${PEEK}"><i class="fa-solid fa-eye"></i> ${PEEK}</button>`
                    : '';
                body.innerHTML =
`<div class="svn-pan-chip svn-coin-bar">
  <span class="svn-pan-bit svn-coin"><i class="fa-solid fa-star"></i> ${amount} <small class="svn-coin-lbl">искр</small></span>
  <span class="svn-coin-acts">
    <button class="svn-coin-btn" data-act="hint"${amount < HINT ? ' disabled' : ''} title="Намёк от персонажа за ${HINT}"><i class="fa-solid fa-lightbulb"></i> ${HINT}</button>
    ${peekBtn}
  </span>
</div>`;
                const hb = body.querySelector('[data-act="hint"]');
                if (hb) hb.addEventListener('click', (e) => { e.stopPropagation(); spendHint(api, HINT); });
                const pb = body.querySelector('[data-act="peek"]');
                if (pb) pb.addEventListener('click', (e) => { e.stopPropagation(); if (spendCoins(PEEK)) revealLoveNumbers(); else api.toast('Не хватает искр'); });
            },
        });

        // ── выборы (à la Клуб романтики) ──────────────────────────────
        registerModule({
            id: 'choices',
            name: 'Выборы',
            desc: 'ИИ предлагает варианты — кнопки в плеере. Дерзкие стоят искр, часть открывается по симпатии.',
            defaultOn: false,
            promptNote() {
                return `[Развилки]
ТОЛЬКО когда игроку уместно самому решить, что делать дальше, заверши ответ (после всего текста и картинок) блоком:
<choices>
короткий вариант от лица игрока
другой вариант
дерзкий/рискованный вариант ::cost=2
</choices>
2–4 варианта, каждый с новой строки, от первого лица, до ~10 слов. Не нужен выбор — блок НЕ пиши. ::cost=N (необязательно) — смелый вариант за N искр.
Для НАПРЯЖЁННЫХ сцен, где решать надо быстро, можешь добавить таймер: <choices time="8"> … </choices> — игроку даётся 8 секунд, иначе выберется первый вариант.`;
            },
            onTurn(api) { renderChoicesUI(api); },
            onFrame(api) { renderChoicesUI(api); },
        });

        // ── музыка по сцене (BGM) ─────────────────────────────────────
        registerModule({
            id: 'bgm',
            name: 'Музыка (BGM)',
            desc: 'Фоновая музыка под сцену: ИИ задаёт трек полем music: в <vn-status>, расширение находит его в бесплатных муз-API и играет. Плейлист (на чат) и поиск — в листе «Музыка».',
            defaultOn: false,
            statusFields() {
                return ['music: трек или настроение под ТЕКУЩУЮ сцену (напр. «lofi rain», «tense orchestral», или конкретное «Артист — Песня»); пусто, если музыку менять не нужно'];
            },
            onOpen(api) { bgmEnsureAudio(); bgmFromScene(api, player.mesId); },
            onTurn(api, mesId) { bgmFromScene(api, mesId); },
            render(api) {
                const body = api.panelBody(); if (!body) return;
                const t = bgm.track;
                body.innerHTML =
`<div class="svn-pan-chip svn-bgm-chip">
  <span class="svn-pan-bit svn-bgm-ti"><i class="fa-solid ${bgm.playing ? 'fa-volume-high' : 'fa-music'}"></i> ${t ? escapeHtml(t.name) : 'музыка'}</span>
  <span class="svn-bgm-mini">
    <button class="svn-bgm-mb" data-bgm="toggle" title="Играть/пауза"><i class="fa-solid ${bgm.playing ? 'fa-pause' : 'fa-play'}"></i></button>
    <button class="svn-bgm-mb" data-bgm="next" title="Следующий"><i class="fa-solid fa-forward-step"></i></button>
    <button class="svn-bgm-mb" data-bgm="open" title="Плейлист"><i class="fa-solid fa-list-ul"></i></button>
  </span>
</div>`;
                const b = (sel, fn) => { const el = body.querySelector(sel); if (el) el.addEventListener('click', e => { e.stopPropagation(); fn(); }); };
                b('[data-bgm="toggle"]', bgmToggle); b('[data-bgm="next"]', bgmNext); b('[data-bgm="open"]', openBgmSheet);
            },
        });

        // ── авто-эмоция спрайта из <vn-status> ────────────────────────
        registerModule({
            id: 'emotion',
            name: 'Эмоция спрайта из статуса',
            desc: 'Эмоция {{char}} из поля emotion: в <vn-status> — спрайт меняет лицо. Нужны загруженные спрайты (Менеджер спрайтов).',
            defaultOn: false,
            statusFields() { return ['emotion: эмоция {{char}} сейчас — англ. ключ (neutral/happy/sad/angry/surprised/shy/smug/serious/love/cry); пусто, если не меняется']; },
            onOpen(api) { _statusEmotion = api.parseStatus(player.mesId).emotion || ''; if (player.open) renderSprites(); },
            onTurn(api, mesId) { const e = api.parseStatus(mesId).emotion; if (e) _statusEmotion = e; if (player.open) renderSprites(); },
        });

        // ── инвентарь / подарки ───────────────────────────────────────
        registerModule({
            id: 'inventory',
            name: 'Инвентарь / подарки',
            desc: 'Предметы (item: +роза, -ключ в <vn-status>). Полка в HUD; список идёт в промпт, чтобы персонаж их помнил.',
            defaultOn: false,
            promptNoteDynamic: true, // список меняется по ходу → в depth=2-реминдер, не в кэшируемый гайд
            statusFields() { return ['item: что персонаж ДАЛ (+роза) или ЗАБРАЛ (-ключ) у игрока этой сценой; через запятую; можно «+монета x3»; пусто — если ничего']; },
            promptNote() {
                const items = (getModState('inventory') || {}).items || [];
                if (!items.length) return '';
                return `[Инвентарь {{user}}]\nУ игрока при себе: ${items.map(it => it.name + (it.qty > 1 ? ' ×' + it.qty : '')).join(', ')}. Помни об этих предметах, можешь на них ссылаться и реагировать.`;
            },
            onTurn(api, mesId) { invApply(api, api.parseStatus(mesId).item); },
            render(api) {
                const body = api.panelBody(); if (!body) return;
                const items = (api.getState() || {}).items || [];
                body.innerHTML = items.length
                    ? `<div class="svn-inv"><span class="svn-inv-ic" title="Инвентарь"><i class="fa-solid fa-bag-shopping"></i></span>${items.map(it => `<span class="svn-inv-it" title="${escapeHtml(it.name)}">${escapeHtml(it.name)}${it.qty > 1 ? `<b>×${it.qty}</b>` : ''}</span>`).join('')}</div>`
                    : '';
            },
        });

        // ── дневник / цели / флаги ────────────────────────────────────
        registerModule({
            id: 'journal',
            name: 'Дневник / цели',
            desc: 'Цели (goal:) и флаги-события (flag:) из <vn-status> — список в HUD, идёт в промпт, чтобы ИИ держал линию.',
            defaultOn: false,
            promptNoteDynamic: true, // цели/вехи меняются по ходу → в depth=2-реминдер, не в кэшируемый гайд
            statusFields() {
                return [
                    'goal: текущая цель/задача игрока в сцене (коротко); несколько — через «;»; пусто — если не менялось',
                    'flag: важная веха/событие, что ТОЛЬКО ЧТО произошло (короткая метка); через «;»; пусто — если ничего',
                ];
            },
            promptNote() {
                const st = getModState('journal') || {}; const g = st.goals || [], f = st.flags || [];
                if (!g.length && !f.length) return '';
                let s = '[Дневник]';
                if (g.length) s += `\nЦели игрока: ${g.join('; ')}.`;
                if (f.length) s += `\nУже случилось: ${f.slice(-8).join('; ')}.`;
                return s;
            },
            onTurn(api, mesId) { jrnApply(api, api.parseStatus(mesId)); },
            render(api) {
                const body = api.panelBody(); if (!body) return;
                const g = (api.getState() || {}).goals || [];
                body.innerHTML = g.length
                    ? `<div class="svn-jrnl"><div class="svn-jrnl-hd"><i class="fa-solid fa-list-check"></i> Цели</div>${g.map(x => `<div class="svn-jrnl-goal">${escapeHtml(x)}</div>`).join('')}</div>`
                    : '';
            },
        });

        // ── итог сцены (рекап) ────────────────────────────────────────
        registerModule({
            id: 'recap',
            name: 'Итог сцены',
            desc: 'На последнем кадре — сводка: Δотношений, черта, искры, подарки. Из <vn-status> ответа.',
            defaultOn: false,
            onFrame(api) { renderRecap(api); },
        });

    }
    // применить операции инвентаря из поля item (+добавить / -убрать, «x3» — количество)
    function invApply(api, raw) {
        raw = String(raw || '').trim(); if (!raw) return;
        const st = api.getState() || { items: [] };
        if (!Array.isArray(st.items)) st.items = [];
        const gained = [];
        for (let tok of raw.split(/[,;]+/)) {
            tok = tok.trim(); if (!tok) continue;
            const neg = tok[0] === '-';
            let name = tok.replace(/^[+\-]\s*/, '').trim();
            let qty = 1; const qm = name.match(/[x×]\s*(\d+)\s*$/i); if (qm) { qty = parseInt(qm[1], 10) || 1; name = name.replace(/[x×]\s*\d+\s*$/i, '').trim(); }
            if (!name) continue;
            const ex = st.items.find(i => i.name.toLowerCase() === name.toLowerCase());
            if (neg) { if (ex) { ex.qty -= qty; if (ex.qty <= 0) st.items.splice(st.items.indexOf(ex), 1); } }
            else { if (ex) ex.qty += qty; else st.items.push({ name, qty }); gained.push(name + (qty > 1 ? ' ×' + qty : '')); }
        }
        api.setState(st);
        if (gained.length) api.float({ text: '🎁 ' + gained.join(', '), kind: 'coin' });
        updateInjection(); // обновить [Инвентарь] в промпте
    }
    // применить цели/флаги из <vn-status>
    function jrnApply(api, st) {
        const cur = api.getState() || { goals: [], flags: [] };
        if (!Array.isArray(cur.goals)) cur.goals = [];
        if (!Array.isArray(cur.flags)) cur.flags = [];
        let changed = false;
        if (st.goal) { cur.goals = st.goal.split(/;+/).map(s => s.trim()).filter(Boolean).slice(0, 5); changed = true; }
        if (st.flag) { for (const f of st.flag.split(/;+/).map(s => s.trim()).filter(Boolean)) { if (!cur.flags.includes(f)) { cur.flags.push(f); changed = true; } } while (cur.flags.length > 30) cur.flags.shift(); }
        if (changed) { api.setState(cur); updateInjection(); }
    }
    // карточка-итог на последнем кадре (модуль «recap»)
    function renderRecap(api) {
        const ov = api.overlay(); if (!ov) return;
        const dlg = ov.querySelector('#svn-dialog'); if (!dlg) return;
        let box = dlg.querySelector('#svn-recap');
        if (!api.isLastFrame() || player.waiting) { if (box) box.remove(); return; }
        const st = api.parseStatus(player.mesId);
        const bits = [];
        const dnum = (ic, cls, v) => { if (v == null || v === 0) return; bits.push(`<span class="svn-recap-b svn-recap-${cls}"><i class="fa-solid ${ic}"></i> ${v > 0 ? '+' : ''}${v}</span>`); };
        dnum('fa-heart', 'love', st.symp); dnum('fa-handshake-simple', 'trust', st.trust); dnum('fa-fire', 'attr', st.attr);
        if (moduleEnabled('currency') && _turnCoins > 0) bits.push(`<span class="svn-recap-b svn-recap-coin"><i class="fa-solid fa-star"></i> +${_turnCoins}</span>`);
        if (st.trait) bits.push(`<span class="svn-recap-b"><i class="fa-solid fa-tag"></i> ${escapeHtml(st.trait)}</span>`);
        if (st.item) {
            const got = st.item.split(/[,;]+/).map(t => t.trim()).filter(t => t && t[0] !== '-').map(t => t.replace(/^\+\s*/, ''));
            if (got.length) bits.push(`<span class="svn-recap-b svn-recap-gift"><i class="fa-solid fa-gift"></i> ${escapeHtml(got.join(', '))}</span>`);
        }
        if (!bits.length) { if (box) box.remove(); return; }
        if (!box) { box = document.createElement('div'); box.id = 'svn-recap'; const ch = dlg.querySelector('#svn-choices'), ctrls = dlg.querySelector('.svn-controls'); dlg.insertBefore(box, ch || ctrls); }
        box.innerHTML = `<div class="svn-recap-hd"><i class="fa-solid fa-clipboard-check"></i> Итог сцены</div><div class="svn-recap-row">${bits.join('')}</div>`;
    }

    // сцена из тега: <vn-status> (place/mood/time/weather) + <datetime> календаря. true — данные были.
    function sceneFromStatus(api, mesId) {
        const st = api.parseStatus(mesId);
        const hasSceneFields = !!(st.place || st.mood || st.time || st.weather);
        // нет ни полей сцены, ни календаря → пусть отработает запасной лёгкий ИИ
        if (!hasSceneFields && !st.hasDatetime) return false;
        const prev = api.getState() || {};
        api.setState({
            time: st.time || prev.time || '',
            place: st.place || prev.place || '',
            mood: st.mood || prev.mood || '',
            weather: st.weather || prev.weather || '',
            date: st.date || prev.date || '',
        });
        return true;
    }

    // helpers love-score
    function newLove() { return { symp: 0, trust: 0, attr: 0, traits: [], reason: '', stage: loveStage(0) }; }
    function loveStage(v) {
        if (v <= -30) return 'неприязнь';
        if (v < 0) return 'настороже';
        if (v < 20) return 'знакомство';
        if (v < 45) return 'симпатия';
        if (v < 70) return 'влюблённость';
        if (v < 90) return 'влюблён(а)';
        return 'возлюбленные';
    }
    const clampDelta = (n) => { const v = parseInt(n, 10); return isNaN(v) ? 0 : Math.max(-10, Math.min(10, v)); };
    // применить дельты отношений (из тега <vn-status> ИЛИ из ответа лёгкого ИИ) — общий путь
    function applyLoveDeltas(api, ds, dt, da, reason, trait) {
        ds = clampDelta(ds); dt = clampDelta(dt); da = clampDelta(da);
        const cur = api.getState() || newLove();
        const prevStage = cur.stage, prevSymp = cur.symp; // снимок ДО мутации (cur — та же ссылка, что в стейте)
        const clamp = (n) => Math.max(-100, Math.min(100, n));
        cur.symp = clamp(cur.symp + ds); cur.trust = clamp(cur.trust + dt); cur.attr = clamp(cur.attr + da);
        trait = String(trait || '').trim().toLowerCase().replace(/[.!,;]+$/, '');
        if (trait && trait.length <= 24 && !cur.traits.includes(trait)) { cur.traits.push(trait); while (cur.traits.length > 6) cur.traits.shift(); }
        cur.reason = String(reason || '').trim().slice(0, 120);
        cur.stage = loveStage(cur.symp);
        api.setState(cur);
        // искры за тёплые моменты + бонус за переход на новую стадию (если валюта включена)
        const gain = (ds > 0 ? ds : 0) + (da > 0 ? da : 0);
        if (gain > 0) addCoins(gain);
        if (cur.stage !== prevStage && cur.symp > prevSymp) addCoins(10);
        const tot = ds + dt + da;
        if (cur.reason && (ds || dt || da)) api.float({ text: (tot >= 0 ? '❤ ' : '💔 ') + cur.reason, kind: tot > 0 ? 'love' : (tot < 0 ? 'bad' : 'info') });
    }
    // запасной путь: лёгкий ИИ судит последний обмен и отдаёт дельты
    function loveEvaluate(api) {
        const sys = 'Ты — система отношений визуальной новеллы в духе «Клуба романтики». Оцени, как ПОСЛЕДНИЙ обмен репликами (реплика игрока и реакция персонажа на неё) изменил отношение персонажа к игроку. Ответь СТРОГО одним JSON-объектом без пояснений: {"sympathy":Δ,"trust":Δ,"attraction":Δ,"reason":"...","trait":"..."}. Каждое Δ — целое от -10 до 10 (0 = без изменений; будь сдержан, крупные сдвиги только на сильных моментах). "reason" — короткая фраза НА РУССКОМ от лица наблюдателя, почему так (например «ей понравилась твоя дерзость», «его насторожил твой холод»); пусто, если ничего не изменилось. "trait" — ОДНО слово-черта, которую персонаж отметил в игроке этой репликой (дерзкий, заботливый, честный, лживый…), или пусто.';
        const st0 = api.getState() || newLove();
        const user = `Персонаж: ${api.charName()}\nИгрок: ${api.userName()}\nТекущее отношение (скрытые числа -100..100): симпатия ${st0.symp}, доверие ${st0.trust}, влечение ${st0.attr}.\n\n[Последние реплики]\n${api.recentTurns(getSettings().liteCtxTurns || 4)}`;
        api.ask({ system: sys, user, json: true, maxTokens: 160 }).then(d => {
            if (!d || typeof d !== 'object') return;
            applyLoveDeltas(api, d.sympathy, d.trust, d.attraction, d.reason, d.trait);
        });
    }

    // ── валюта (движок-уровень: чтобы love/choices могли начислять/тратить) ──
    function getCoins() { const c = allModuleState()['currency']; return c ? (c.amount || 0) : 0; }
    function addCoins(n, reason) {
        if (!moduleEnabled('currency')) return;
        n = Math.round(n) || 0; if (!n) return;
        const a = allModuleState(); const c = a['currency'] || { amount: 0, earned: 0 };
        c.amount = Math.max(0, (c.amount || 0) + n);
        if (n > 0) { c.earned = (c.earned || 0) + n; _turnCoins += n; }
        a['currency'] = c; saveSettings();
        const def = MODULES.find(m => m.id === 'currency');
        if (def && player.open) { renderModulePanel(def); if (n > 0 && reason) playerFloat('✨ +' + n + ' · ' + reason, 'coin'); }
    }
    function spendCoins(n) {
        n = Math.round(n) || 0; if (n <= 0) return true;
        const a = allModuleState(); const c = a['currency'] || { amount: 0, earned: 0 };
        if ((c.amount || 0) < n) return false;
        c.amount -= n; a['currency'] = c; saveSettings();
        const def = MODULES.find(m => m.id === 'currency');
        if (def && player.open) renderModulePanel(def);
        return true;
    }
    // ── траты искр: показ скрытых цифр отношений + намёк от персонажа ──
    function revealLoveNumbers() {
        _loveReveal = true;
        if (player.open) {
            const lv = MODULES.find(m => m.id === 'love'); if (lv) renderModulePanel(lv);
            const cu = MODULES.find(m => m.id === 'currency'); if (cu) renderModulePanel(cu);
        }
    }
    function spendHint(api, cost) {
        if (getCoins() < cost) { api.toast('Не хватает искр'); return; }
        const sys = 'Ты — внутренний голос-подсказчик визуальной новеллы. По сцене коротко (одна фраза, до 12 слов, на русском) намекни игроку, чего ПЕРСОНАЖ сейчас хочет или ждёт от него. Без кавычек и префиксов.';
        const user = `Персонаж: ${api.charName()}\nИгрок: ${api.userName()}\n\n[Сцена]\n${api.recentTurns(getSettings().liteCtxTurns || 4)}`;
        api.toast('Спрашиваю намёк…');
        // искры спишутся ТОЛЬКО при удачном намёке (ниже), чтобы пустой ответ не стоил денег
        api.ask({ system: sys, user, json: false, maxTokens: 60 }).then(txt => {
            const hint = String(txt || '').trim().replace(/^[\s"«»]+|[\s"«»]+$/g, '');
            if (!hint) { api.toast('Намёк не вышел — искры не списаны'); return; }
            if (!spendCoins(cost)) { api.toast('Не хватает искр'); return; }
            api.float({ text: '💡 ' + hint.slice(0, 140), kind: 'info' });
        });
    }

    // ── выборы: парс <choices> + рендер кнопок в диалоге ──────────────
    function parseChoices(raw) {
        if (!raw) return [];
        // закрытый блок; если ответ обрезан без </choices> — берём до следующего служебного блока
        // (<vn-status>/<datetime>/</vn>) или до конца, чтобы варианты показались, но поля статуса в них не попали
        const m = raw.match(/<choices\b[^>]*>([\s\S]*?)<\/choices>/i)
              || raw.match(/<choices\b[^>]*>([\s\S]*?)(?=<vn-status|<datetime|<\/vn>|$)/i); if (!m) return [];
        const out = [];
        for (let line of m[1].split('\n')) {
            line = line.trim().replace(/^[-*•\s]+/, ''); if (!line) continue;
            const o = { text: '', cost: 0, need: 0, tone: '' };
            line = line.replace(/::\s*cost\s*=\s*(\d+)/i, (_, n) => { o.cost = parseInt(n, 10) || 0; return ''; });
            line = line.replace(/::\s*need\s*=\s*\D*(\d+)/i, (_, n) => { o.need = parseInt(n, 10) || 0; return ''; });
            line = line.replace(/::\s*tone\s*=\s*([^\s:]+)/i, (_, t) => { o.tone = t; return ''; });
            o.text = line.trim().replace(/\s{2,}/g, ' ');
            if (o.text) out.push(o);
            if (out.length >= 4) break;
        }
        return out;
    }
    // секунды таймера из <choices time="N"> (0 — без таймера)
    function choicesTime(raw) {
        if (!raw) return 0;
        const m = raw.match(/<choices\b([^>]*)>/i); if (!m) return 0;
        const t = m[1].match(/\btime\s*=\s*["']?(\d+)/i);
        return t ? Math.max(0, Math.min(120, parseInt(t[1], 10) || 0)) : 0;
    }
    function renderChoicesUI(api) {
        const ov = api.overlay(); if (!ov) return;
        const dlg = ov.querySelector('#svn-dialog'); if (!dlg) return;
        let box = dlg.querySelector('#svn-choices');
        const mesId = player.mesId;
        const msg = (getCtx().chat || [])[mesId];
        const list = msg ? parseChoices(msg.mes || '') : [];
        const st = api.getState() || {};
        const answered = !!(st.answered && st.answered[mesId]);
        const show = list.length && api.isLastFrame() && !player.waiting && !answered;
        if (!show) { clearChoiceTimer(); if (box) box.remove(); return; }
        const econ = moduleEnabled('currency');
        const coins = getCoins();
        const love = getModState('love'); const symp = love ? love.symp : 0;
        const fresh = !box;
        if (!box) { box = document.createElement('div'); box.id = 'svn-choices'; const ctrls = dlg.querySelector('.svn-controls'); dlg.insertBefore(box, ctrls); }
        const secs = choicesTime(msg && msg.mes) || (moduleCfg('choices').timer || 0); // таймер: из <choices time="N"> или дефолт модуля
        const timerBar = secs > 0 ? `<div class="svn-ch-timer"><span style="animation-duration:${secs}s"></span></div>` : '';
        box.innerHTML = timerBar + list.map((c, i) => {
            const locked = c.need > 0 && symp < c.need;
            const poor = econ && c.cost > 0 && coins < c.cost;
            const dis = locked || poor;
            const tags = [];
            if (c.tone) tags.push(`<span class="svn-ch-tone">${escapeHtml(c.tone)}</span>`);
            if (econ && c.cost > 0) tags.push(`<span class="svn-ch-cost"><i class="fa-solid fa-star"></i> ${c.cost}</span>`);
            if (c.need > 0) tags.push(`<span class="svn-ch-need${locked ? ' svn-ch-lock' : ''}"><i class="fa-solid fa-heart"></i> ${c.need}</span>`);
            return `<button class="svn-choice${(econ && c.cost > 0) ? ' svn-choice-prem' : ''}${dis ? ' svn-choice-dis' : ''}" data-i="${i}"${dis ? ' disabled' : ''}><span class="svn-ch-txt">${escapeHtml(c.text)}</span>${tags.length ? `<span class="svn-ch-tags">${tags.join('')}</span>` : ''}</button>`;
        }).join('');
        box.querySelectorAll('.svn-choice').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const c = list[parseInt(btn.dataset.i, 10)]; if (!c) return;
                if (c.need > 0 && symp < c.need) { api.toast('Нужно больше симпатии'); return; }
                if (econ && c.cost > 0 && !spendCoins(c.cost)) { api.toast('Не хватает искр'); return; }
                clearChoiceTimer();
                const s2 = api.getState() || {}; if (!s2.answered) s2.answered = {}; s2.answered[mesId] = true; api.setState(s2);
                if (box) box.remove();
                api.send(c.text);
            });
        });
        // таймер на выбор: по истечении сам жмёт первый доступный вариант (КР-стиль)
        if (fresh && secs > 0) {
            clearChoiceTimer();
            _choiceTimer = setTimeout(() => {
                _choiceTimer = null;
                const b = dlg.querySelector('#svn-choices'); if (!b) return;
                const first = b.querySelector('.svn-choice:not(:disabled)');
                if (first) first.click(); else b.remove();
            }, secs * 1000);
        }
    }

    // ── инициализация ─────────────────────────────────────────────────
    function init() {
        const ctx = getCtx();
        getSettings();
        registerBuiltinModules();
        updateInjection();
        loadSpriteCache();
        if (getSettings().hasCustomBg) loadCustomBg(); // подтянуть свой фон из IndexedDB (для bgMode='custom')
        try { applyGlobalTheme(); } catch (e) { /* ignore */ } // тема на карточки-лаунчеры в ленте чата
        const E = ctx.event_types || {};
        if (E.APP_READY) ctx.eventSource.on(E.APP_READY, () => { createSettingsUI(); updateInjection(); loadSpriteCache(); setTimeout(decorateAll, 300); });
        if (E.CHAT_CHANGED) ctx.eventSource.on(E.CHAT_CHANGED, () => { _turnApplied.clear(); _turnSnapshots.clear(); _liteError.clear(); _sceneCache.clear(); _directorDone.clear(); _directorBusy.clear(); _selfEmit.clear(); updateInjection(); bgm.lastQuery = ''; if (player.open) bgmRefreshUI(); setTimeout(decorateAll, 200); });
        setTimeout(() => { createSettingsUI(); decorateAll(); }, 1500);
        for (const name of ['GENERATION_STARTED', 'GENERATE_BEFORE_COMBINE_PROMPTS', 'MESSAGE_SENT']) {
            const ev = E[name]; if (ev) ctx.eventSource.on(ev, () => { try { updateInjection(); } catch (e) { /* ignore */ } });
        }
        if (E.MESSAGE_RECEIVED) ctx.eventSource.on(E.MESSAGE_RECEIVED, enforceImageDefaults);
        if (E.CHARACTER_MESSAGE_RENDERED) ctx.eventSource.on(E.CHARACTER_MESSAGE_RENDERED, onCharMessageRendered);
        if (E.STREAM_TOKEN_RECEIVED) ctx.eventSource.on(E.STREAM_TOKEN_RECEIVED, onStreamToken);
        for (const name of ['GENERATION_ENDED', 'GENERATION_STOPPED']) { const ev = E[name]; if (ev) ctx.eventSource.on(ev, onGenDone); }
        if (E.MESSAGE_UPDATED) ctx.eventSource.on(E.MESSAGE_UPDATED, (id) => setTimeout(() => decorateMessage(id), 80));
        if (E.MESSAGE_SWIPED) ctx.eventSource.on(E.MESSAGE_SWIPED, (id) => setTimeout(() => {
            decorateMessage(id);
            if (player.open && player.mesId === id && isVnMessage(id)) openPlayer(id);
        }, 120));
        const chatEl = document.getElementById('chat');
        if (chatEl) {
            const obs = new MutationObserver(muts => {
                for (const m of muts) for (const node of m.addedNodes) {
                    if (node.nodeType !== 1 || !node.classList || !node.classList.contains('mes')) continue;
                    const id = parseInt(node.getAttribute('mesid'), 10);
                    if (!isNaN(id)) setTimeout(() => decorateMessage(id), 60);
                }
            });
            obs.observe(chatEl, { childList: true, subtree: false });
        }
        window.sillyVN = { open: openPlayer, close: closePlayer, parseScene, openBgPicker, openCastManager: () => openCastManager(true), openSettings: openSettingsPanel, isReady: () => true };
        console.log('[VN] Визуальная новелла — расширение инициализировано');
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
