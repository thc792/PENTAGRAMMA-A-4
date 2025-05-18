/**
 *
 * Piano Tutor Extrame Edition V2 (o il nome attuale del progetto)
 * Copyright (c) 2023-2024 Lorenzetti Giuseppe (aggiorna l'anno se necessario)
 *
 * Tutti i diritti riservati.
 *
 * Questo software è proprietario e confidenziale.
 * È concesso in licenza, non venduto. L'uso, la riproduzione, la modifica
 * o la distribuzione non autorizzata di questo software, o di qualsiasi sua parte,
 * sono severamente vietati.
 *
 * Per informazioni sulla licenza e per i termini di utilizzo completi,
 * fare riferimento al file LICENSE.md disponibile nel repository del progetto:
 * https:https://github.com/thc792/PENTAGRAMMA-A-4/blob/main/LICENSE.md]
 * o contattare [pianothc791@gmail.com].
 */

document.addEventListener('DOMContentLoaded', () => {
    // Funzione helper per mostrare errori all'utente
    function displayError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.textContent = message;
        errorDiv.style.color = 'red'; errorDiv.style.fontWeight = 'bold'; errorDiv.style.border = '1px solid red';
        errorDiv.style.padding = '10px'; errorDiv.style.marginTop = '10px'; errorDiv.style.backgroundColor = '#ffebee';
        const h1 = document.querySelector('h1');
        if (h1) { h1.parentNode.insertBefore(errorDiv, h1.nextSibling); }
        else { document.body.insertBefore(errorDiv, document.body.firstChild); }
    }

    // Verifica Librerie Essenziali
    if (typeof Vex === 'undefined' || typeof Vex.Flow === 'undefined') { console.error("VexFlow non caricato."); displayError("Errore: Impossibile caricare la libreria VexFlow."); return; }
    if (typeof Vex.Flow.RESOLUTION === 'undefined' || !Vex.Flow.RESOLUTION) { console.error("Vex.Flow.RESOLUTION non definito."); displayError("Errore: Problema con la libreria VexFlow (RESOLUTION)."); return; }
    if (typeof html2canvas === 'undefined') { console.error("html2canvas non caricato."); displayError("Errore: Libreria html2canvas mancante (necessaria per 'Salva Immagine')."); }

    // Import/Destructuring VexFlow
    const { Renderer, Stave, StaveConnector, StaveNote, Formatter, Voice, Accidental, GhostNote, Beam, BarNote, Barline, TimeSignature } = Vex.Flow;

    // --- Variabili Globali ---
    const staveContainers = document.querySelectorAll('.stave-container');
    const systems = [];
    let currentSystemIndex = 0;
    const maxMeasuresPerSystem = 4;
    const activeNotes = new Map();
    let notesToProcessQueue = [];
    let processingTimerId = null;
    const processingTimeoutMs = 50;
    let selectedSystemIndex = -1;
    let selectedElementIndex = -1;
    let highlightOverlay = null;
    let currentTimeSignature = "4/4";
    const TICKS_PER_WHOLE = Vex.Flow.RESOLUTION;
    const TICKS_PER_QUARTER = TICKS_PER_WHOLE / 4;
    const midiStatusDiv = document.getElementById('midi-status');
    const lastNoteDiv = document.getElementById('last-note');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const deleteLastBtn = document.getElementById('delete-last-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const downloadImageBtn = document.getElementById('download-image-btn');
    const selectionStatusDiv = document.getElementById('selection-status');
    const timeSigSelect = document.getElementById('timeSig');
    const scoreContentDiv = document.getElementById('score-content');

    // Variabili per la palette strumenti
    const restToolButtons = document.querySelectorAll('.rest-tool');
    let currentRestInsertClef = 'treble';
    const clefSelectButtons = document.querySelectorAll('.clef-select-button');
    let accidentalPreference = 'sharps';
    const accidentalPrefButtons = document.querySelectorAll('.accidental-pref-button');

    const staveWidth = 900; const staveX = 10; const trebleY = 10; const bassY = 90; const containerHeight = 190;

    // --- Funzioni Utilità Tempo/Durata ---
    function getDurationTicks(durationString) {
        const type = durationString.replace('r', '').replace('d', ''); let baseTicks = 0;
        switch (type) {
            case 'w': baseTicks = TICKS_PER_WHOLE; break; case 'h': baseTicks = TICKS_PER_WHOLE / 2; break;
            case 'q': baseTicks = TICKS_PER_WHOLE / 4; break; case '8': baseTicks = TICKS_PER_WHOLE / 8; break;
            case '16': baseTicks = TICKS_PER_WHOLE / 16; break; case '32': baseTicks = TICKS_PER_WHOLE / 32; break;
            default: console.warn(`Durata VexFlow non riconosciuta: ${durationString}. Restituisco 0 tick.`); return 0;
        } return baseTicks;
    }
    function calculateMeasureCapacity(timeSignatureString) {
        let ts = timeSignatureString; if (ts === 'C') ts = '4/4'; if (ts === 'C|') ts = '2/2';
        const parts = ts.split('/'); if (parts.length !== 2) { console.error(`Formato Time Sig non valido: ${ts}. Default 4/4.`); return 4 * TICKS_PER_QUARTER; }
        const numerator = parseInt(parts[0], 10); const denominator = parseInt(parts[1], 10);
        if (isNaN(numerator) || isNaN(denominator) || denominator <= 0 || !Number.isInteger(Math.log2(denominator))) { console.error(`Valori Time Sig non validi: ${ts}. Default a 4/4.`); return 4 * TICKS_PER_QUARTER; }
        const beatValueTicks = TICKS_PER_WHOLE / denominator;
        const capacity = numerator * beatValueTicks;
        if (isNaN(capacity) || capacity <= 0) { console.error(`Capacità calcolata non valida (${capacity}) per ${ts}. Default a 4/4.`); return 4 * TICKS_PER_QUARTER; }
        return capacity;
    }

    const initialMeasureCapacity = calculateMeasureCapacity(currentTimeSignature);
    if (initialMeasureCapacity === undefined || initialMeasureCapacity <= 0) {
         console.error(`ERRORE CRITICO: Capacità iniziale non valida (${initialMeasureCapacity}). Impossibile continuare.`);
         displayError("Errore critico nell'inizializzazione (capacità battuta).");
         return;
    }

    // --- Inizializzazione Sistemi Pentagrammi ---
    staveContainers.forEach((container, index) => {
        try {
            const renderer = new Renderer(container, Renderer.Backends.SVG);
            renderer.resize(staveWidth + staveX * 2, containerHeight);
            const context = renderer.getContext(); context.setFont('Arial', 10);
            if (typeof initialMeasureCapacity !== 'number' || initialMeasureCapacity <= 0) { throw new Error(`Capacità non valida: ${initialMeasureCapacity}`); }
            systems.push({
                id: container.id, container: container, renderer: renderer, context: context,
                elements: [],
                timeSignature: currentTimeSignature,
                measureCapacityTicks: initialMeasureCapacity,
                trebleStave: null, bassStave: null
            });
            redrawSystem(systems[index]);
        } catch (error) { console.error(`Errore inizializzazione sistema ${container.id}:`, error); container.innerHTML = `<p style="color:red; font-weight:bold;">Errore inizializzazione pentagramma ${index + 1}.</p>`; }
    });
    if (systems.length === staveContainers.length && systems[0]?.measureCapacityTicks > 0) {
        console.log(`Creati ${systems.length} sistemi. Tempo: ${currentTimeSignature}, Capacità: ${systems[0].measureCapacityTicks} ticks.`);
    } else {
        console.error(`ERRORE: Inizializzazione sistemi fallita.`);
        displayError("Errore nell'inizializzazione dei pentagrammi.");
    }

    // --- Event Listener per Cambio Tempo ---
    timeSigSelect.addEventListener('change', (event) => {
        currentTimeSignature = event.target.value; const newCapacity = calculateMeasureCapacity(currentTimeSignature);
        if (typeof newCapacity !== 'number' || newCapacity <= 0) { console.error(`Capacità non valida per ${currentTimeSignature}`); return; }
        console.log(`Tempo cambiato a: ${currentTimeSignature}, Nuova capacità: ${newCapacity} ticks.`);
        systems.forEach(system => {
             system.timeSignature = currentTimeSignature;
             system.measureCapacityTicks = newCapacity;
             redrawSystem(system);
        });
        deselectElement();
    });

    // --- Inizializzazione MIDI ---
    if (navigator.requestMIDIAccess) { midiStatusDiv.textContent = 'Richiesta accesso MIDI...'; navigator.requestMIDIAccess({ sysex: false }).then(onMIDISuccess, onMIDIFailure); }
    else { midiStatusDiv.textContent = 'Web MIDI API non supportata.'; console.warn("Web MIDI API non supportata!"); }
    function onMIDISuccess(midiAccess) { midiStatusDiv.textContent = 'Accesso MIDI OK. In ascolto...'; connectInputs(midiAccess); midiAccess.onstatechange = () => { console.log('Stato MIDI cambiato, ricollego...'); midiStatusDiv.textContent = 'Stato MIDI cambiato, ricollego...'; connectInputs(midiAccess); }; }
    function connectInputs(midiAccess) { const inputs = midiAccess.inputs.values(); let foundDevice = false; midiAccess.inputs.forEach(input => input.onmidimessage = null); midiAccess.inputs.forEach(input => { input.onmidimessage = handleMIDIMessage; console.log('Ascolto su:', input.name); if (!foundDevice) { midiStatusDiv.textContent = `Ascolto su: ${input.name} (e altri se presenti)`; foundDevice = true; } }); if (!foundDevice) midiStatusDiv.textContent = 'Nessun dispositivo MIDI trovato.'; }
    function onMIDIFailure(msg) { midiStatusDiv.textContent = `Errore accesso MIDI: ${msg}`; console.error(`Errore MIDI: ${msg}`); }

    // --- Gestione Input MIDI con Durata ---
    function handleMIDIMessage(event) {
        const command = event.data[0] >> 4; const noteNumber = event.data[1]; const velocity = event.data[2]; const timestamp = performance.now();
        lastNoteDiv.textContent = `MIDI: Cmd=${command}, Nota=${noteNumber}, Vel=${velocity}`;
        if (command === 9 && velocity > 0) { activeNotes.set(noteNumber, timestamp); console.log(`Note On: ${noteNumber} at ${timestamp.toFixed(0)}`); }
        else if (command === 8 || (command === 9 && velocity === 0)) {
            if (activeNotes.has(noteNumber)) {
                const startTime = activeNotes.get(noteNumber); const pressDurationMs = timestamp - startTime; activeNotes.delete(noteNumber);
                console.log(`Note Off: ${noteNumber}, Durata: ${pressDurationMs.toFixed(2)} ms`);
                notesToProcessQueue.push({ noteNumber, pressDurationMs });
                if (processingTimerId) clearTimeout(processingTimerId);
                processingTimerId = setTimeout(() => { processQueuedNotes(); processingTimerId = null; }, processingTimeoutMs);
            } else { console.warn(`Note Off per ${noteNumber} senza Note On.`); }
        }
    }
    function mapDuration(pressDurationMs) {
        const wholeNoteMin = 3000; const halfNoteMin = 1500; const quarterNoteMin = 500; const eighthNoteMin = 250; const sixteenthNoteMin = 125; const thirtySecondNoteMin = 50;
        if (pressDurationMs >= wholeNoteMin) return "w"; else if (pressDurationMs >= halfNoteMin) return "h"; else if (pressDurationMs >= quarterNoteMin) return "q"; else if (pressDurationMs >= eighthNoteMin) return "8"; else if (pressDurationMs >= sixteenthNoteMin) return "16"; else if (pressDurationMs >= thirtySecondNoteMin) return "32"; else if (pressDurationMs > 0) { console.log(`Durata (${pressDurationMs.toFixed(2)} ms) -> "32"`); return "32"; } else { console.warn(`Durata non valida (${pressDurationMs} ms) -> "q"`); return "q"; }
    }

    // Helper per creare StaveNote
    function createStaveNote(keys, duration, clef) {
    const noteDuration = duration.replace('r', '');
    // 'keys' qui può essere ["c#/4"], ["bb/4"], ["eb/4"], ["b/4"] etc.
    // VexFlow interpreta queste stringhe per determinare l'altezza corretta.
    let note = new StaveNote({ keys: keys, duration: noteDuration, clef: clef, auto_stem: true });

    keys.forEach((keyString, index) => {
        const pitchName = keyString.split('/')[0]; // es. "c#", "bb", "eb", "b"

        // Gestione Diesis
        if (pitchName.includes('##') || pitchName.includes('x')) {
            note.addModifier(new Accidental('##'), index);
        } else if (pitchName.includes('#')) {
            note.addModifier(new Accidental('#'), index);
        }
        // Gestione Bemolli
        else if (pitchName === 'bb') { // Se la chiave è "bb" (prodotta per La# con pref. bemolle)
            note.addModifier(new Accidental('b'), index); // Mostra un SINGOLO bemolle (perché "bb" è il Si bemolle)
        } else if (pitchName.length === 2 && pitchName.endsWith('b')) {
            // Questo cattura "db", "eb", "gb", "ab".
            // Esclude "bb" (già gestito) e "b" (Si naturale, che non deve avere alterazione qui).
            note.addModifier(new Accidental('b'), index);
        }
        // Non aggiungiamo un Accidental per "b" (Si naturale) o "e" (Mi naturale)
        // perché non hanno un'alterazione intrinseca nel nome che vogliamo sempre mostrare.
    });
    return note;
}

    // Processa le note accodate
    function processQueuedNotes() {
        if (notesToProcessQueue.length === 0) return;
        const notesToProcess = [...notesToProcessQueue]; notesToProcessQueue = [];
        let shortestDuration = "w"; const durationValues = { "w": 128, "h": 64, "q": 32, "8": 16, "16": 8, "32": 4 }; let minDurationValue = durationValues[shortestDuration];
        notesToProcess.forEach(note => { const dur = mapDuration(note.pressDurationMs); if (durationValues[dur] !== undefined && durationValues[dur] < minDurationValue) { minDurationValue = durationValues[dur]; shortestDuration = dur; } });
        const commonDuration = shortestDuration;

        let newTrebleElement = null; let newBassElement = null;
        const trebleNotesData = notesToProcess.filter(n => n.noteNumber >= 60);
        const bassNotesData = notesToProcess.filter(n => n.noteNumber < 60);

        const trebleKeys = trebleNotesData.map(n => midiNumberToNoteName(n.noteNumber, accidentalPreference)).filter(Boolean);
        const bassKeys = bassNotesData.map(n => midiNumberToNoteName(n.noteNumber, accidentalPreference)).filter(Boolean);

        console.log("processQueuedNotes: Treble keys for StaveNote:", JSON.stringify(trebleKeys));
        console.log("processQueuedNotes: Bass keys for StaveNote:", JSON.stringify(bassKeys));

        if (trebleKeys.length > 0) newTrebleElement = createStaveNote(trebleKeys, commonDuration, "treble");
        if (bassKeys.length > 0) newBassElement = createStaveNote(bassKeys, commonDuration, "bass");

        if (!newTrebleElement && !newBassElement) { console.warn("Batch non ha prodotto note valide."); return; }

        if (newTrebleElement && !newBassElement) {
            newBassElement = new GhostNote({ duration: commonDuration });
        } else if (!newTrebleElement && newBassElement) {
            newTrebleElement = new GhostNote({ duration: commonDuration });
        }
        insertElementOnScore(newTrebleElement, newBassElement);
    }

    // Funzione per creare un elemento Pausa
    function createRestElement(baseDuration) {
        const clefForRest = currentRestInsertClef;
        const restKey = clefForRest === "bass" ? "d/3" : "b/4";
        let rest = new StaveNote({
            keys: [restKey],
            duration: baseDuration + "r",
            clef: clefForRest
        });
        return rest;
    }

    // Funzione per gestire l'inserimento di un elemento
    function insertElementOnScore(elementTreble, elementBass) {
        const actualElement = (elementTreble instanceof StaveNote || elementTreble instanceof GhostNote) ? elementTreble : elementBass;
        if (!actualElement || typeof actualElement.getTicks !== 'function') {
            console.error("Nessun elemento valido o VexFlow Tickable da inserire.", actualElement);
            return;
        }
        const durationTicks = actualElement.getTicks().value();

        if (selectedSystemIndex !== -1 && selectedElementIndex !== -1) {
            const targetSystem = systems[selectedSystemIndex];
            if (targetSystem && selectedElementIndex < targetSystem.elements.length) {
                console.log("Sostituzione/Unione elemento selezionato con nuovo elemento.");
                targetSystem.elements[selectedElementIndex] = {
                    trebleElement: elementTreble,
                    bassElement: elementBass
                };
                redrawSystem(targetSystem);
                updateHighlight();
            } else {
                console.error("Indice selezione non valido per sostituzione.");
                deselectElement();
                appendElement({ trebleElement: elementTreble, bassElement: elementBass }, durationTicks);
            }
        } else {
            appendElement({ trebleElement: elementTreble, bassElement: elementBass }, durationTicks);
        }
    }

    // Event Listener per i pulsanti della palette Pause
    restToolButtons.forEach(button => {
        button.addEventListener('click', () => {
            const baseDuration = button.dataset.duration;
            console.log(`Inserimento Pausa: ${baseDuration} in chiave ${currentRestInsertClef}`);

            const newRest = createRestElement(baseDuration);
            const correspondingGhost = new GhostNote({ duration: baseDuration });

            if (currentRestInsertClef === 'treble') {
                insertElementOnScore(newRest, correspondingGhost);
            } else {
                insertElementOnScore(correspondingGhost, newRest);
            }
        });
    });

    // Event Listener per i pulsanti di Selezione Chiave Inserimento Pausa
    clefSelectButtons.forEach(button => {
        button.addEventListener('click', () => {
            currentRestInsertClef = button.dataset.clef;
            console.log("Chiave inserimento pausa impostata a:", currentRestInsertClef);
            clefSelectButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });

    // Event Listener per i pulsanti di Preferenza Alterazione
    accidentalPrefButtons.forEach(button => {
        button.addEventListener('click', () => {
            accidentalPreference = button.dataset.preference;
            console.log("Preferenza alterazione impostata a:", accidentalPreference);
            accidentalPrefButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        });
    });

    // Funzione helper per aggiungere un elemento alla fine (gestisce wrap)
    function appendElement(elementPair, durationTicks) {
        if (currentSystemIndex >= systems.length) { console.warn("Tutti i sistemi sono pieni. Impossibile aggiungere nota."); return; }
        let systemIndexToModify = currentSystemIndex; let targetSystem = systems[systemIndexToModify];
        targetSystem.elements.push(elementPair); console.log(`Aggiunto elemento (${durationTicks} ticks) al sistema ${systemIndexToModify}`);
        recalculateCurrentSystemIndex();
        redrawSystem(targetSystem);
        deselectElement();
    }

    // Ridisegna un sistema
    function redrawSystem(system) {
    // ... (codice iniziale di redrawSystem: pulizia SVG, creazione stave, connettori) ...
    if (!system || !system.context || !system.renderer) { /* ... */ return; }
    const { context, renderer, elements, timeSignature, measureCapacityTicks } = system;
    // ... (altro codice per inizializzare stave, voci, ecc. come prima) ...
    const svg = system.container.querySelector('svg');
    if (svg) { while (svg.lastChild && svg.lastChild.tagName !== 'defs') { svg.removeChild(svg.lastChild); } }
    else { console.error("SVG non trovato per sistema", system.id); return; }

    let timeSigObj; try { timeSigObj = new TimeSignature(timeSignature); } catch(e) { console.error("Errore TimeSig:", e); timeSigObj = new TimeSignature("4/4");}
    const clefWidth = 30; const timeSigWidth = timeSigObj.getWidth() + 10;
    const startXOffset = clefWidth + timeSigWidth;
    const mainStaveX = staveX + startXOffset;
    const mainStaveWidth = staveWidth - startXOffset;

    const initialTrebleStave = new Stave(staveX, trebleY, startXOffset).addClef("treble").addTimeSignature(timeSignature);
    const initialBassStave = new Stave(staveX, bassY, startXOffset).addClef("bass").addTimeSignature(timeSignature);
    const trebleStave = new Stave(mainStaveX, trebleY, mainStaveWidth);
    const bassStave = new Stave(mainStaveX, bassY, mainStaveWidth);

    initialTrebleStave.setContext(context).draw();
    initialBassStave.setContext(context).draw();
    trebleStave.setContext(context).draw();
    bassStave.setContext(context).draw();

    new StaveConnector(initialTrebleStave, initialBassStave).setType(StaveConnector.type.BRACE).setContext(context).draw();
    new StaveConnector(initialTrebleStave, initialBassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
    new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();

    const trebleVoice = new Voice({ time: { num_beats: 4, beat_value: 4 } }).setStrict(false);
    const bassVoice = new Voice({ time: { num_beats: 4, beat_value: 4 } }).setStrict(false);
    const finalTickablesTreble = [];
    const finalTickablesBass = [];
    const allBeams = [];
    let currentMeasureTrebleNotes = [];
    let currentMeasureBassNotes = [];
    let currentMeasureTicksInLoop = 0;

    elements.forEach((el, index) => {
        // ... (logica esistente per calcolare elementTicks e popolare finalTickables e currentMeasure...Notes)
        let elementTicks = 0;
        let primaryElementForTicks = null;
        if (el.trebleElement && !(el.trebleElement instanceof GhostNote)) {
            primaryElementForTicks = el.trebleElement;
        } else if (el.bassElement && !(el.bassElement instanceof GhostNote)) {
            primaryElementForTicks = el.bassElement;
        } else {
            primaryElementForTicks = el.trebleElement || el.bassElement;
        }

        if (primaryElementForTicks && typeof primaryElementForTicks.getTicks === 'function') {
            elementTicks = primaryElementForTicks.getTicks().value();
        } else {
            console.warn("Redraw: Impossibile ottenere ticks per l'elemento:", el, "Fallback a 0.");
        }

        if (el.trebleElement) {
            finalTickablesTreble.push(el.trebleElement);
            if (el.trebleElement instanceof StaveNote && !el.trebleElement.isRest()) {
                 currentMeasureTrebleNotes.push(el.trebleElement);
            }
        }
        if (el.bassElement) {
            finalTickablesBass.push(el.bassElement);
             if (el.bassElement instanceof StaveNote && !el.bassElement.isRest()) {
                currentMeasureBassNotes.push(el.bassElement);
             }
        }
        currentMeasureTicksInLoop += elementTicks;
        if (currentMeasureTicksInLoop >= measureCapacityTicks) {
            console.log(`Fine misura ${Math.floor(finalTickablesTreble.filter(t => t instanceof BarNote).length + 1)} nel sistema ${system.id}. Ticks: ${currentMeasureTicksInLoop}/${measureCapacityTicks}`);
            if (currentMeasureTrebleNotes.length > 1) { allBeams.push(...Beam.generateBeams(currentMeasureTrebleNotes.filter(n => ["8", "16", "32"].includes(n.duration)))); }
            if (currentMeasureBassNotes.length > 1) { allBeams.push(...Beam.generateBeams(currentMeasureBassNotes.filter(n => ["8", "16", "32"].includes(n.duration)))); }
            if (index < elements.length - 1) {
                finalTickablesTreble.push(new BarNote(Barline.type.SINGLE));
                finalTickablesBass.push(new BarNote(Barline.type.SINGLE));
            }
            currentMeasureTrebleNotes = []; currentMeasureBassNotes = [];
            currentMeasureTicksInLoop %= measureCapacityTicks;
            if (currentMeasureTicksInLoop === 0 && elementTicks > 0 && currentMeasureTicksInLoop !== measureCapacityTicks) { /* No-op */ }
            console.log(`Ticks resettati a ${currentMeasureTicksInLoop} per prossima misura.`);
        }
    });
    if (currentMeasureTrebleNotes.length > 1) { allBeams.push(...Beam.generateBeams(currentMeasureTrebleNotes.filter(n => ["8", "16", "32"].includes(n.duration))));}
    if (currentMeasureBassNotes.length > 1) { allBeams.push(...Beam.generateBeams(currentMeasureBassNotes.filter(n => ["8", "16", "32"].includes(n.duration))));}


    if (finalTickablesTreble.length > 0) trebleVoice.addTickables(finalTickablesTreble);
    if (finalTickablesBass.length > 0) bassVoice.addTickables(finalTickablesBass);

    try {
         if (trebleVoice.getTickables().length > 0 || bassVoice.getTickables().length > 0) {
            // La chiamata a Accidental.applyAccidentals(...) è stata RIMOSSA/COMMENTATA
            // // Accidental.applyAccidentals([trebleVoice, bassVoice]); // <-- RIMUOVI o COMMENTA QUESTA RIGA

            const formatter = new Formatter().joinVoices([trebleVoice, bassVoice]);
            const formatWidth = mainStaveWidth - 50;
            if (formatWidth > 0) {
                formatter.format([trebleVoice, bassVoice], formatWidth);
            } else {
                console.warn("Larghezza formattazione <= 0 per sistema", system.id);
                formatter.format([trebleVoice, bassVoice]);
            }

            trebleVoice.draw(context, trebleStave);
            bassVoice.draw(context, bassStave);
            allBeams.forEach(beam => beam.setContext(context).draw());
            console.log(`Sistema ${system.id} ridisegnato.`);
        } else {
            console.log(`Sistema ${system.id} vuoto.`);
        }
    } catch (e) {
        console.error(`Errore durante formattazione/disegno sistema ${system.id}:`, e);
        displayError(`Errore nel disegno del pentagramma ${system.id}. Dettagli in console.`);
    }
    system.trebleStave = trebleStave;
    system.bassStave = bassStave;
    updateHighlight();
}

    // --- Logica di Navigazione e Eliminazione ---
    prevBtn.addEventListener('click', navigatePrev);
    nextBtn.addEventListener('click', navigateNext);
    deleteLastBtn.addEventListener('click', deleteLastElement);
    deleteSelectedBtn.addEventListener('click', deleteSelectedElement);

    function navigatePrev() { if (selectedSystemIndex === -1 || selectedElementIndex === -1) { findLastElement(); } else { selectedElementIndex--; if (selectedElementIndex < 0) { selectedSystemIndex--; if (selectedSystemIndex < 0) { deselectElement(); } else { selectedElementIndex = systems[selectedSystemIndex].elements.length - 1; if(selectedElementIndex < 0) deselectElement(); } } } updateSelectionStatus(); updateHighlight(); }
    function navigateNext() { if (selectedSystemIndex === -1 || selectedElementIndex === -1) { findFirstElement(); } else { selectedElementIndex++; if (selectedElementIndex >= systems[selectedSystemIndex].elements.length) { selectedSystemIndex++; while(selectedSystemIndex < systems.length && systems[selectedSystemIndex].elements.length === 0) { selectedSystemIndex++; } if (selectedSystemIndex >= systems.length) { deselectElement(); } else { selectedElementIndex = 0; } } } updateSelectionStatus(); updateHighlight(); }
    function findFirstElement() { for (let i = 0; i < systems.length; i++) { if (systems[i].elements.length > 0) { selectedSystemIndex = i; selectedElementIndex = 0; updateSelectionStatus(); updateHighlight(); return; } } deselectElement(); }
    function findLastElement() { for (let i = systems.length - 1; i >= 0; i--) { if (systems[i].elements.length > 0) { selectedSystemIndex = i; selectedElementIndex = systems[i].elements.length - 1; updateSelectionStatus(); updateHighlight(); return; } } deselectElement(); }
    function updateSelectionStatus() { if (selectedSystemIndex !== -1 && selectedElementIndex !== -1) { selectionStatusDiv.textContent = `UNIONE/SOSTITUZIONE ATTIVA: Sistema ${selectedSystemIndex + 1}, Posizione ${selectedElementIndex + 1}`; selectionStatusDiv.style.color = 'red'; } else { selectionStatusDiv.textContent = "Elemento selezionato: Nessuno (Modalità Aggiunta)"; selectionStatusDiv.style.color = 'black'; } }
    function deselectElement() { selectedSystemIndex = -1; selectedElementIndex = -1; updateSelectionStatus(); updateHighlight(); }

    function deleteLastElement() {
        console.log("Tentativo di eliminare l'ultimo elemento...");
        deselectElement();
        let lastSystemIndexWithElements = -1;
        for (let i = systems.length - 1; i >= 0; i--) { if (systems[i].elements.length > 0) { lastSystemIndexWithElements = i; break; } }
        if (lastSystemIndexWithElements === -1) { console.log("Nessun elemento da eliminare."); return; }
        const targetSystem = systems[lastSystemIndexWithElements];
        const removedElementPair = targetSystem.elements.pop();
        if (removedElementPair) {
            console.log(`Elemento rimosso dal sistema ${lastSystemIndexWithElements}`);
            recalculateCurrentSystemIndex();
            redrawSystem(targetSystem);
        } else { console.log("Non c'erano elementi nell'ultimo sistema trovato."); }
    }

    function deleteSelectedElement() {
        console.log("Tentativo di eliminare l'elemento selezionato...");
        if (selectedSystemIndex === -1 || selectedElementIndex === -1) { console.log("Nessun elemento selezionato da eliminare."); return; }
        const targetSystem = systems[selectedSystemIndex];
        if (!targetSystem || selectedElementIndex < 0 || selectedElementIndex >= targetSystem.elements.length) { console.error("Selezione non valida per eliminazione."); deselectElement(); return; }
        const removedElementPair = targetSystem.elements.splice(selectedElementIndex, 1)[0];
        if (removedElementPair) {
            console.log(`Elemento ${selectedElementIndex} rimosso dal sistema ${selectedSystemIndex}`);
            deselectElement();
            recalculateCurrentSystemIndex();
            redrawSystem(targetSystem);
        } else { console.warn("splice non ha rimosso elementi? Indice:", selectedElementIndex); deselectElement(); }
    }

    // Funzione per ricalcolare l'indice del sistema corrente
    function recalculateCurrentSystemIndex() {
        currentSystemIndex = 0;
        for (let i = 0; i < systems.length; i++) {
            let completedMeasures = 0;
            let ticksInCheck = 0;
            const system = systems[i];
            for (const el of system.elements) {
                let ticks = 0;
                let primaryElementForTicks = null;
                if (el.trebleElement && !(el.trebleElement instanceof GhostNote)) {
                    primaryElementForTicks = el.trebleElement;
                } else if (el.bassElement && !(el.bassElement instanceof GhostNote)) {
                    primaryElementForTicks = el.bassElement;
                } else {
                    primaryElementForTicks = el.trebleElement || el.bassElement;
                }
                if (primaryElementForTicks && typeof primaryElementForTicks.getTicks === 'function') {
                    ticks = primaryElementForTicks.getTicks().value();
                } else {
                     console.warn("Recalculate: Impossibile ottenere ticks per l'elemento:", el);
                }
                ticksInCheck += ticks;
                if (ticksInCheck >= system.measureCapacityTicks) {
                    completedMeasures++;
                    ticksInCheck %= system.measureCapacityTicks;
                    if (ticksInCheck === 0 && ticks > 0) { /* no-op */ }
                }
            }
            if (completedMeasures < maxMeasuresPerSystem) {
                currentSystemIndex = i;
                console.log(`Indice sistema per prossimo inserimento ricalcolato a: ${currentSystemIndex} (Sistema ${i+1} non pieno)`);
                return;
            }
        }
        currentSystemIndex = systems.length;
        console.log(`Indice sistema per prossimo inserimento ricalcolato a: ${currentSystemIndex} (Tutti i sistemi pieni)`);
    }

    // --- Evidenziazione Visiva ---
     function updateHighlight() {
        if (highlightOverlay) { highlightOverlay.remove(); highlightOverlay = null; }
        if (selectedSystemIndex === -1 || selectedElementIndex === -1) return;
        const system = systems[selectedSystemIndex];
        if (!system || !system.trebleStave || !system.bassStave || selectedElementIndex < 0 || selectedElementIndex >= system.elements.length) {
             console.warn("Tentativo di highlight su sistema/elemento non valido o non ancora disegnato.", selectedSystemIndex, selectedElementIndex);
             return;
        }
        const elementPair = system.elements[selectedElementIndex];
        if (!elementPair) return;
        const targetElement = (elementPair.trebleElement && !(elementPair.trebleElement instanceof GhostNote))
                               ? elementPair.trebleElement
                               : elementPair.bassElement;
        if (!targetElement || targetElement instanceof GhostNote) {
             console.log("Elemento selezionato è GhostNote o non visualizzabile, nessun highlight.");
             return;
        }
        const referenceStave = system.trebleStave;
        if (!targetElement.getBoundingBox || typeof targetElement.getAbsoluteX !== 'function' || !referenceStave) {
            console.warn("Elemento o Stave di riferimento non validi per calcolare highlight.", targetElement, referenceStave);
            return;
        }
        try {
             const bb = targetElement.getBoundingBox();
             const absoluteX = targetElement.getAbsoluteX();
             if (absoluteX === null || typeof absoluteX === 'undefined') {
                 console.warn("Impossibile ottenere X assoluta per highlight.");
                 return;
             }
             const width = bb ? (bb.getW() || 25) : 25;
             const topY = trebleY - 10;
             const bottomY = bassY + 80;
             const fullHeight = bottomY - topY;
             const highlightX = absoluteX - (width / 2);
             createHighlightOverlay(system.container, highlightX, topY, width, fullHeight);
        } catch (e) {
            console.error("Errore durante il calcolo del BoundingBox/Highlight:", e, targetElement);
            const fallbackX = 50;
            createHighlightOverlay(system.container, fallbackX - 15, 5, 30, containerHeight - 10);
        }
    }
    function createHighlightOverlay(container, x, y, width, height) {
        if (highlightOverlay) highlightOverlay.remove();
        highlightOverlay = document.createElement('div');
        highlightOverlay.className = 'highlight-overlay';
        if (!isNaN(x) && !isNaN(y) && !isNaN(width) && !isNaN(height)) {
            highlightOverlay.style.left = `${x}px`;
            highlightOverlay.style.top = `${y}px`;
            highlightOverlay.style.width = `${width}px`;
            highlightOverlay.style.height = `${height}px`;
            container.appendChild(highlightOverlay);
        } else {
            console.error("Valori non validi per creare l'overlay:", {x, y, width, height});
        }
    }

    // Funzione di conversione MIDI
    function midiNumberToNoteName(midiNumber, preference = 'sharps') {
    if (midiNumber < 0 || midiNumber > 127) return null;
    const octave = Math.floor(midiNumber / 12) - 1;
    const noteIndex = midiNumber % 12;

    const sharpNoteNames = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
    
    // Array per i bemolli: VexFlow usa "bb" per Si bemolle, "eb" per Mi bemolle, ecc. nella proprietà 'keys'.
    const flatKeyNames  = [
    // Stringa per VexFlow 'keys' | Indice | Nota MIDI equivalente (diesis)
       "c",                            // 0      | C
       "db",                           // 1      | C#
       "d",                            // 2      | D
       "eb",                           // 3      | D#
       "e",                            // 4      | E
       "f",                            // 5      | F
       "gb",                           // 6      | F#
       "g",                            // 7      | G
       "ab",                           // 8      | G#
       "a",                            // 9      | A
       "bb",                           // 10     | A# (La# diventa Si bemolle)
       "b"                             // 11     | B
    ];


    let noteName;
    if (preference === 'flats') {
        noteName = flatKeyNames[noteIndex]; // Usa l'array corretto per le chiavi VexFlow
    } else { 
        noteName = sharpNoteNames[noteIndex];
    }
    console.log(`midiNumberToNoteName: MIDI=${midiNumber}, Pref=${preference}, Result=${noteName}/${octave}`);
    return `${noteName}/${octave}`;
}

}); // Fine DOMContentLoaded