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
    if (typeof html2canvas === 'undefined') { console.error("html2canvas non caricato."); displayError("Errore: Libreria html2canvas mancante (necessaria per 'Salva Immagine')."); } // Non blocca

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
    const downloadImageBtn = document.getElementById('download-image-btn');
    const selectionStatusDiv = document.getElementById('selection-status');
    const timeSigSelect = document.getElementById('timeSig');
    const scoreContentDiv = document.getElementById('score-content');

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

    // --- Inizializzazione Sistemi Pentagrammi ---
    const staveWidth = 750; const staveX = 10; const trebleY = 10; const bassY = 90; const containerHeight = 190;
    const initialMeasureCapacity = calculateMeasureCapacity(currentTimeSignature);
    if (initialMeasureCapacity === undefined || initialMeasureCapacity <= 0) {
         console.error(`ERRORE CRITICO: Capacità iniziale non valida (${initialMeasureCapacity}). Impossibile continuare.`);
         displayError("Errore critico nell'inizializzazione (capacità battuta).");
         return;
    }

    staveContainers.forEach((container, index) => {
        try {
            const renderer = new Renderer(container, Renderer.Backends.SVG);
            renderer.resize(staveWidth + staveX * 2, containerHeight);
            const context = renderer.getContext(); context.setFont('Arial', 10);
            // *** NON creiamo stave qui ***
            if (typeof initialMeasureCapacity !== 'number' || initialMeasureCapacity <= 0) { throw new Error(`Capacità non valida: ${initialMeasureCapacity}`); }
            systems.push({
                id: container.id, container: container, renderer: renderer, context: context,
                // Rimuoviamo trebleStave/bassStave da qui
                elements: [], timeSignature: currentTimeSignature,
                measureCapacityTicks: initialMeasureCapacity,
                // Rimosso hasBeenDrawn
            });
             redrawSystem(systems[index]); // Forza ridisegno iniziale
        } catch (error) { console.error(`Errore inizializzazione sistema ${container.id}:`, error); container.innerHTML = `<p style="color:red; font-weight:bold;">Errore inizializzazione pentagramma ${index + 1}.</p>`; }
    });
    if (systems.length === staveContainers.length && systems[0]?.measureCapacityTicks > 0) { console.log(`Creati ${systems.length} sistemi. Tempo: ${currentTimeSignature}, Capacità: ${systems[0].measureCapacityTicks} ticks.`); }
    else { console.error(`ERRORE: Inizializzazione sistemi fallita.`); displayError("Errore nell'inizializzazione dei pentagrammi."); }

    // --- Event Listener per Cambio Tempo ---
    timeSigSelect.addEventListener('change', (event) => {
        currentTimeSignature = event.target.value; const newCapacity = calculateMeasureCapacity(currentTimeSignature);
        if (typeof newCapacity !== 'number' || newCapacity <= 0) { /*...*/ return; }
        console.log(`Tempo cambiato a: ${currentTimeSignature}, Nuova capacità: ${newCapacity} ticks.`);
        systems.forEach(system => {
             system.timeSignature = currentTimeSignature;
             system.measureCapacityTicks = newCapacity;
             // Rimosso hasBeenDrawn
             redrawSystem(system); // Ridisegna con il nuovo tempo
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

    // Processa le note accodate dopo il timeout
    function processQueuedNotes() {
        if (notesToProcessQueue.length === 0) return; const notesToProcess = [...notesToProcessQueue]; notesToProcessQueue = []; console.log("Processo batch:", notesToProcess);
        let shortestDuration = "w"; const durationValues = { "w": 128, "h": 64, "q": 32, "8": 16, "16": 8, "32": 4 }; let minDurationValue = durationValues[shortestDuration];
        notesToProcess.forEach(note => { const dur = mapDuration(note.pressDurationMs); if (durationValues[dur] !== undefined && durationValues[dur] < minDurationValue) { minDurationValue = durationValues[dur]; shortestDuration = dur; } });
        const commonDuration = shortestDuration; const commonDurationTicks = getDurationTicks(commonDuration); console.log(`Batch: Durata comune=${commonDuration} (${commonDurationTicks} ticks)`);
        let newTrebleElement = null; let newBassElement = null; const trebleNotesData = notesToProcess.filter(n => n.noteNumber >= 60); const bassNotesData = notesToProcess.filter(n => n.noteNumber < 60); const trebleKeys = trebleNotesData.map(n => midiNumberToNoteName(n.noteNumber)).filter(Boolean); const bassKeys = bassNotesData.map(n => midiNumberToNoteName(n.noteNumber)).filter(Boolean);
        if (trebleKeys.length > 0) newTrebleElement = createStaveNote(trebleKeys, commonDuration, "treble"); if (bassKeys.length > 0) newBassElement = createStaveNote(bassKeys, commonDuration, "bass"); if (!newTrebleElement && !newBassElement) { console.warn("Batch non ha prodotto note valide."); return; }
        if (selectedSystemIndex !== -1 && selectedElementIndex !== -1) { // Modalità Unione/Sostituzione
            const targetSystem = systems[selectedSystemIndex];
            if (targetSystem && selectedElementIndex < targetSystem.elements.length) { console.warn("Sostituzione nota: la struttura delle battute non viene ricalcolata."); const existingElementPair = targetSystem.elements[selectedElementIndex]; let finalTrebleElement = existingElementPair.trebleElement; let finalBassElement = existingElementPair.bassElement; if (newTrebleElement) finalTrebleElement = newTrebleElement; if (newBassElement) finalBassElement = newBassElement; if (finalTrebleElement instanceof StaveNote && !(finalBassElement instanceof StaveNote)) finalBassElement = new GhostNote({ duration: commonDuration }); else if (finalBassElement instanceof StaveNote && !(finalTrebleElement instanceof StaveNote)) finalTrebleElement = new GhostNote({ duration: commonDuration }); targetSystem.elements[selectedElementIndex] = { trebleElement: finalTrebleElement, bassElement: finalBassElement }; redrawSystem(targetSystem); updateHighlight(); // Non resettare hasBeenDrawn qui
            } else { console.error("Indice selezione non valido."); deselectElement(); const newElementPair = { trebleElement: newTrebleElement, bassElement: newBassElement }; if (newElementPair.trebleElement && !newElementPair.bassElement) newElementPair.bassElement = new GhostNote({ duration: commonDuration }); else if (!newElementPair.trebleElement && newElementPair.bassElement) newElementPair.trebleElement = new GhostNote({ duration: commonDuration }); appendElement(newElementPair, commonDurationTicks); }
        } else { // Modalità Append
            const newElementPair = { trebleElement: newTrebleElement, bassElement: newBassElement }; if (newElementPair.trebleElement && !newElementPair.bassElement) newElementPair.bassElement = new GhostNote({ duration: commonDuration }); else if (!newElementPair.trebleElement && newElementPair.bassElement) newElementPair.trebleElement = new GhostNote({ duration: commonDuration }); appendElement(newElementPair, commonDurationTicks);
        }
    }

    // Funzione helper per aggiungere un elemento alla fine (gestisce wrap)
    function appendElement(elementPair, durationTicks) {
        if (currentSystemIndex >= systems.length) { console.warn("Tutti i sistemi sono pieni. Impossibile aggiungere nota."); return; }
        let systemIndexToModify = currentSystemIndex; let targetSystem = systems[systemIndexToModify];
        targetSystem.elements.push(elementPair); console.log(`Aggiunto elemento (${durationTicks} ticks) al sistema ${systemIndexToModify}`);
        let completedMeasures = 0; let ticksInCurrentMeasureCheck = 0;
        for (const el of targetSystem.elements) {
            let ticks = 0;
            if (el.trebleElement && (el.trebleElement instanceof StaveNote || el.trebleElement instanceof GhostNote)) { ticks = getDurationTicks(el.trebleElement.getDuration() + (el.trebleElement.isRest() ? 'r' : '')); }
            else if (el.bassElement && (el.bassElement instanceof StaveNote || el.bassElement instanceof GhostNote)) { ticks = getDurationTicks(el.bassElement.getDuration() + (el.bassElement.isRest() ? 'r' : '')); }
            ticksInCurrentMeasureCheck += ticks;
            if (ticksInCurrentMeasureCheck >= targetSystem.measureCapacityTicks) { completedMeasures++; ticksInCurrentMeasureCheck %= targetSystem.measureCapacityTicks; if (ticksInCurrentMeasureCheck === 0 && ticks > 0) { /* no-op */ } }
        }
        console.log(`Sistema ${systemIndexToModify} ora contiene ${completedMeasures} misure complete.`);
        if (completedMeasures >= maxMeasuresPerSystem) {
            console.log(`Sistema ${systemIndexToModify} ha raggiunto il limite di ${maxMeasuresPerSystem} misure.`);
            currentSystemIndex++;
            if (currentSystemIndex < systems.length) { console.log(`La prossima nota andrà al sistema ${currentSystemIndex}.`); }
            else { console.warn("Tutti i sistemi sono pieni!"); }
        }
        redrawSystem(targetSystem);
        deselectElement();
    }

    // Helper per creare StaveNote (Corretto per 'b')
     function createStaveNote(keys, duration, clef) {
        const noteDuration = duration.replace('r', '');
        let note = new StaveNote({ keys: keys, duration: noteDuration, clef: clef, auto_stem: true });
        keys.forEach((key, index) => {
            if (key.includes('#')) { note.addModifier(new Accidental("#"), index); }
            else if (key.endsWith('b') && !key.endsWith('bb')) { note.addModifier(new Accidental("b"), index); }
        });
        return note;
    }

    // Ridisegna un sistema (Versione che CREA Stave ogni volta)
    function redrawSystem(system) {
        if (!system || !system.context || !system.renderer) { console.error("Tentativo di ridisegnare un sistema non valido (manca context/renderer):", system); return; }
        const { context, renderer, elements, timeSignature, measureCapacityTicks } = system;
        const svg = system.container.querySelector('svg');
        if (svg) { while (svg.lastChild && svg.lastChild.tagName !== 'defs') { svg.removeChild(svg.lastChild); } }
        else { console.error("SVG non trovato per sistema", system.id); return; }

        // --- 1. Crea NUOVI Stave per Clef/Tempo e Note ---
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

        // --- 2. Ridisegna i Connettori ---
        new StaveConnector(initialTrebleStave, initialBassStave).setType(StaveConnector.type.BRACE).setContext(context).draw();
        new StaveConnector(initialTrebleStave, initialBassStave).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
        new StaveConnector(trebleStave, bassStave).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();

        // --- 3. Prepara le Voci e Inserisci le BarNote (Logica Corretta) ---
        const trebleVoice = new Voice({ time: { num_beats: 4, beat_value: 4 } }).setStrict(false);
        const bassVoice = new Voice({ time: { num_beats: 4, beat_value: 4 } }).setStrict(false);
        const tickablesTreble = [];
        const tickablesBass = [];
        let currentMeasureTicksInLoop = 0;

        elements.forEach((el, index) => {
            let elementTicks = 0;
            let currentElementTreble = el.trebleElement; let currentElementBass = el.bassElement;
            if (currentElementTreble && (currentElementTreble instanceof StaveNote || currentElementTreble instanceof GhostNote)) { elementTicks = getDurationTicks(currentElementTreble.getDuration() + (currentElementTreble.isRest() ? 'r' : '')); }
            else if (currentElementBass && (currentElementBass instanceof StaveNote || currentElementBass instanceof GhostNote)) { elementTicks = getDurationTicks(currentElementBass.getDuration() + (currentElementBass.isRest() ? 'r' : '')); }

            // Aggiungi SEMPRE l'elemento corrente
            if (currentElementTreble) tickablesTreble.push(currentElementTreble);
            if (currentElementBass) tickablesBass.push(currentElementBass);
            currentMeasureTicksInLoop += elementTicks;

            // Controlla se la misura è COMPLETA o SUPERATA *dopo* aver aggiunto
            // E non è l'ultimo elemento in assoluto
            if (currentMeasureTicksInLoop >= measureCapacityTicks && index < elements.length - 1) {
                console.log(`Misura completata/superata DOPO elemento ${index}. Ticks: ${currentMeasureTicksInLoop}/${measureCapacityTicks}`);
                tickablesTreble.push(new BarNote(Barline.type.SINGLE));
                tickablesBass.push(new BarNote(Barline.type.SINGLE));
                currentMeasureTicksInLoop %= measureCapacityTicks;
                 if (currentMeasureTicksInLoop === 0 && elementTicks > 0 && currentMeasureTicksInLoop !== measureCapacityTicks) { /* no-op */ }
                 console.log(`Ticks resettati a ${currentMeasureTicksInLoop} per prossima misura.`);
            }
        });

        if (tickablesTreble.length > 0) trebleVoice.addTickables(tickablesTreble);
        if (tickablesBass.length > 0) bassVoice.addTickables(tickablesBass);

        // --- 4. Formatta e Disegna le Voci ---
        try {
             if (trebleVoice.getTickables().length > 0 || bassVoice.getTickables().length > 0) {
                const formatter = new Formatter().joinVoices([trebleVoice, bassVoice]);
                const formatWidth = mainStaveWidth - 20;
                if (formatWidth > 0) { formatter.format([trebleVoice, bassVoice], formatWidth); }
                else { console.warn("Larghezza formattazione <= 0."); formatter.format([trebleVoice, bassVoice]); }
                const beams = [ ...Beam.generateBeams(tickablesTreble.filter(t => t instanceof StaveNote && !t.isRest() && ["8", "16", "32"].includes(t.duration))), ...Beam.generateBeams(tickablesBass.filter(t => t instanceof StaveNote && !t.isRest() && ["8", "16", "32"].includes(t.duration))) ];
                trebleVoice.draw(context, trebleStave); bassVoice.draw(context, bassStave); beams.forEach(beam => beam.setContext(context).draw());
                console.log(`Sistema ${system.id} ridisegnato (note).`);
            } else { console.log(`Sistema ${system.id} vuoto (note).`); }
        } catch (e) { console.error("Errore format/draw:", e); }

        // Aggiorna gli stave nel sistema per l'highlight
        system.trebleStave = trebleStave;
        system.bassStave = bassStave;
        updateHighlight();
    }

    // --- Logica di Navigazione ---
    prevBtn.addEventListener('click', navigatePrev);
    nextBtn.addEventListener('click', navigateNext);
    deleteLastBtn.addEventListener('click', deleteLastElement);

    function navigatePrev() { if (selectedSystemIndex === -1 || selectedElementIndex === -1) { findLastElement(); } else { selectedElementIndex--; if (selectedElementIndex < 0) { selectedSystemIndex--; if (selectedSystemIndex < 0) { deselectElement(); } else { selectedElementIndex = systems[selectedSystemIndex].elements.length - 1; if(selectedElementIndex < 0) deselectElement(); } } } updateSelectionStatus(); updateHighlight(); }
    function navigateNext() { if (selectedSystemIndex === -1 || selectedElementIndex === -1) { findFirstElement(); } else { selectedElementIndex++; if (selectedElementIndex >= systems[selectedSystemIndex].elements.length) { selectedSystemIndex++; while(selectedSystemIndex < systems.length && systems[selectedSystemIndex].elements.length === 0) { selectedSystemIndex++; } if (selectedSystemIndex >= systems.length) { deselectElement(); } else { selectedElementIndex = 0; } } } updateSelectionStatus(); updateHighlight(); }
    function findFirstElement() { for (let i = 0; i < systems.length; i++) { if (systems[i].elements.length > 0) { selectedSystemIndex = i; selectedElementIndex = 0; updateSelectionStatus(); updateHighlight(); return; } } deselectElement(); }
    function findLastElement() { for (let i = systems.length - 1; i >= 0; i--) { if (systems[i].elements.length > 0) { selectedSystemIndex = i; selectedElementIndex = systems[i].elements.length - 1; updateSelectionStatus(); updateHighlight(); return; } } deselectElement(); }
    function updateSelectionStatus() { if (selectedSystemIndex !== -1 && selectedElementIndex !== -1) { selectionStatusDiv.textContent = `UNIONE/SOSTITUZIONE ATTIVA: Sistema ${selectedSystemIndex + 1}, Posizione ${selectedElementIndex + 1}`; selectionStatusDiv.style.color = 'red'; } else { selectionStatusDiv.textContent = "Elemento selezionato: Nessuno (Modalità Aggiunta)"; selectionStatusDiv.style.color = 'black'; } }
    function deselectElement() { selectedSystemIndex = -1; selectedElementIndex = -1; updateSelectionStatus(); updateHighlight(); }

    // Funzione Elimina Ultimo Elemento (Corretta)
    function deleteLastElement() {
        console.log("Tentativo di eliminare l'ultimo elemento...");
        deselectElement();
        let lastSystemIndexWithElements = -1;
        for (let i = systems.length - 1; i >= 0; i--) { if (systems[i].elements.length > 0) { lastSystemIndexWithElements = i; break; } }
        if (lastSystemIndexWithElements === -1) { console.log("Nessun elemento da eliminare."); return; }
        const targetSystem = systems[lastSystemIndexWithElements];
        const removedElement = targetSystem.elements.pop();
        if (removedElement) {
            console.log(`Elemento rimosso dal sistema ${lastSystemIndexWithElements}`);
            // Ricalcola currentSystemIndex
            currentSystemIndex = 0;
            for(let i = 0; i < systems.length; i++) {
                let completedMeasures = 0; let ticksInCheck = 0;
                for(const el of systems[i].elements) {
                    let ticks = 0;
                    if (el.trebleElement && (el.trebleElement instanceof StaveNote || el.trebleElement instanceof GhostNote)) { ticks = getDurationTicks(el.trebleElement.getDuration() + (el.trebleElement.isRest() ? 'r' : '')); }
                    else if (el.bassElement && (el.bassElement instanceof StaveNote || el.bassElement instanceof GhostNote)) { ticks = getDurationTicks(el.bassElement.getDuration() + (el.bassElement.isRest() ? 'r' : '')); }
                    ticksInCheck += ticks;
                    if (ticksInCheck >= systems[i].measureCapacityTicks) { completedMeasures++; ticksInCheck %= systems[i].measureCapacityTicks; if(ticksInCheck === 0 && ticks > 0){} }
                }
                if (completedMeasures < maxMeasuresPerSystem) { currentSystemIndex = i; break; }
                 if (i === systems.length - 1 && completedMeasures >= maxMeasuresPerSystem) { currentSystemIndex = systems.length; }
            }
             console.log("Indice sistema per prossimo inserimento aggiornato a:", currentSystemIndex);
            redrawSystem(targetSystem); // Ridisegna il sistema modificato
        } else { console.log("Non c'erano elementi nell'ultimo sistema trovato."); }
    }

    // --- Evidenziazione Visiva ---
     function updateHighlight() {
        if (highlightOverlay) { highlightOverlay.remove(); highlightOverlay = null; } if (selectedSystemIndex === -1 || selectedElementIndex === -1) return; const system = systems[selectedSystemIndex]; if (!system || selectedElementIndex < 0 || selectedElementIndex >= system.elements.length) { deselectElement(); return; } const elementPair = system.elements[selectedElementIndex]; if (!elementPair) return; const targetElement = elementPair.trebleElement instanceof GhostNote ? elementPair.bassElement : elementPair.trebleElement; if (!targetElement || targetElement instanceof GhostNote) { return; }
        // Usa lo stave CORRENTE (quello appena creato in redrawSystem) per l'highlight
        const targetStave = system.trebleStave; // Prendiamo uno dei due, getAbsoluteX dovrebbe funzionare
        if (!targetElement.getBoundingBox || !targetStave) { console.warn("Elemento o Stave non validi per highlight."); return; }
        try {
             const bb = targetElement.getBoundingBox();
             const absoluteX = targetElement.getAbsoluteX ? targetElement.getAbsoluteX() : (bb ? bb.getX() + targetStave.getNoteStartX() : null);
             if (!absoluteX) { console.warn("Impossibile ottenere X per highlight."); return; }
             if (!bb) { const width = 30; const y = trebleY - 10; const height = bassY + 80 - y; createHighlightOverlay(system.container, absoluteX - width/2, y, width, height); }
             else { const width = bb.getW() || 20; const topY = trebleY - 10; const bottomY = bassY + 80; const fullHeight = bottomY - topY; createHighlightOverlay(system.container, absoluteX, topY, width, fullHeight); }
        } catch (e) { console.error("Errore BoundingBox:", e, targetElement); const x = (targetElement.getAbsoluteX ? targetElement.getAbsoluteX() : 50); createHighlightOverlay(system.container, x - 15, 5, 30, containerHeight - 10); }
    }
    function createHighlightOverlay(container, x, y, width, height) { if (highlightOverlay) highlightOverlay.remove(); highlightOverlay = document.createElement('div'); highlightOverlay.className = 'highlight-overlay'; highlightOverlay.style.left = `${x}px`; highlightOverlay.style.top = `${y}px`; highlightOverlay.style.width = `${width}px`; highlightOverlay.style.height = `${height}px`; container.appendChild(highlightOverlay); }

    // Funzione di conversione MIDI
    function midiNumberToNoteName(midiNumber) { if (midiNumber < 0 || midiNumber > 127) return null; const noteNames = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"]; const octave = Math.floor(midiNumber / 12) - 1; const noteIndex = midiNumber % 12; return `${noteNames[noteIndex]}/${octave}`; }

    // --- LOGICA ESPORTAZIONE IMMAGINE (con html2canvas) ---
    downloadImageBtn.addEventListener('click', generateImage);

    function generateImage() {
        if (typeof html2canvas === 'undefined') { displayError("Errore: Libreria html2canvas non caricata."); return; }
        console.log("Avvio generazione Immagine...");
        const originalButtonText = downloadImageBtn.textContent;
        downloadImageBtn.textContent = "Generazione...";
        downloadImageBtn.disabled = true;
        const options = { scale: 2, useCORS: true, logging: true, backgroundColor: '#ffffff' };
        html2canvas(scoreContentDiv, options).then(canvas => {
            console.log("Canvas generato da html2canvas");
            const link = document.createElement('a'); link.download = 'spartito-midi.png'; link.href = canvas.toDataURL('image/png'); link.click();
            console.log("Download immagine avviato.");
        }).catch(error => { console.error("Errore html2canvas:", error); alert("Errore creazione immagine.");
        }).finally(() => { downloadImageBtn.textContent = originalButtonText; downloadImageBtn.disabled = false; });
    }

}); // Fine DOMContentLoaded