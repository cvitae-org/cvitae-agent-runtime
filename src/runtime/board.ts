import { offerLanguageText } from '../capabilities/detectOfferLanguage.js';
import { randomUUID } from 'node:crypto';
import { OperationError } from '../contracts/operation-error.js';
import { RuntimeError } from '../contracts/index.js';
import type { BoardEntry, BoardCv, BoardWrite, BoardRunInput, PreparationStep, ApplicationStage, BoardAnswer } from '../contracts/board.js';
import { preparationSteps } from '../contracts/board.js';
import type { CvContext, OfferReader, OfferSnapshot, RunRecord } from '../contracts/index.js';
import { boardEvent, currentCv, currentPosting, emptyBoardSteps, type createBoardStore } from '../storage/sqlite/board.js';
import type { RunHandle } from './run.js';

type Ports = {
  reader: OfferReader; contexts: () => readonly CvContext[];
  captureCv: (contextId: string) => Omit<BoardCv, 'id' | 'createdAt' | 'reason'>;
  emptyCv: Record<string, unknown>;
  execute: (input: BoardRunInput, signal: AbortSignal, onText?: (text: string) => void) => RunHandle;
  run: (id: string) => RunRecord | undefined;
  now?: () => number;
  onDrop?: (entryId: string) => void;
};
const hasText = (value: unknown): boolean => typeof value === 'string' ? value.trim().length > 0
  : value !== null && typeof value === 'object' ? Object.values(value).some(hasText) : false;

type Control = BoardWrite & { action: 'prepare' | 'pause' | 'resume' | 'retry' | 'refreshPosting' | 'refreshCv' | 'regenerate' };
export const createBoardService = (store: ReturnType<typeof createBoardStore>, ports: Ports) => {
  const now = ports.now ?? Date.now;
  const active = new Map<string, {controller: AbortController; generation: number}>();
  const abortOutdated = (entryId: string) => {
    const running = active.get(entryId);
    if (running && running.generation !== store.requireEntry(entryId).preparation.generation) running.controller.abort();
  };
  const chats = new Map<string, {controller: AbortController; text: string; entryId: string}>();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  store.recover();
  const snapshot = (entry: BoardEntry): OfferSnapshot => {
    const cv = currentCv(entry), posting = currentPosting(entry), at = now();
    return { id: randomUUID(), conversationId: `board:${entry.id}`, createdAt: at,
      context: cv?.sourceContext ?? { id: `board:${entry.id}`, language: entry.languageOverride ?? 'en', revision: 1, generation: 1, includePhoto: false, createdAt: at, updatedAt: at },
      document: cv?.document ?? { id: `board:${entry.id}`, kind: 'cv', revision: 0, body: ports.emptyCv, createdAt: at, updatedAt: at },
      photo: cv?.photo ?? { revision: 0, photo: null },
      offer: { ...entry.discovery, ...(posting ? { text: posting.text, url: posting.url, finalUrl: posting.finalUrl, stated: posting.stated } : {}) } };
  };
  const nextStep = (entry: BoardEntry): PreparationStep | undefined => preparationSteps.find(step => entry.preparation.steps[step].status !== 'complete');
  const resetFrom = (entry: BoardEntry, from: PreparationStep) => {
    const fresh = emptyBoardSteps();
    for (const step of preparationSteps.slice(preparationSteps.indexOf(from))) entry.preparation.steps[step] = fresh[step];
    entry.preparation.step = from; entry.preparation.generation++; entry.preparation.status = 'queued';
    delete entry.preparation.error; delete entry.preparation.code; delete entry.preparation.retryAt;
  };
  const checkpoint = (id: string, generation: number, step: PreparationStep, update: (entry: BoardEntry) => void) => store.internal(id,generation,entry => {
    update(entry); const state = entry.preparation.steps[step]; state.status = 'complete'; state.completedAt = now(); delete state.error;
    const next = nextStep(entry); entry.preparation.step = next ?? 'summary'; entry.preparation.status = next ? 'running' : 'ready';
    delete entry.preparation.error; delete entry.preparation.code;
    boardEvent(entry, 'preparationCompleted', {step}, now());
  });
  const runStep = async (entry: BoardEntry, step: PreparationStep, capability: string, input: Record<string, unknown>, signal: AbortSignal) => {
    const state = entry.preparation.steps[step];
    let receipt = state.runId ? store.getRun(state.runId) : undefined;
    const previous = receipt ? ports.run(receipt.runId) : undefined;
    if (previous?.status === 'succeeded') return previous.result ?? {};
    if (!receipt || (previous && !['queued','running'].includes(previous.status))) {
      receipt = {runId: randomUUID(), entryId: entry.id, generation: entry.preparation.generation, step, capability, input, snapshot: snapshot(entry)};
    }
    const captured = receipt;
    store.transaction(() => {
      store.storeRun(captured);
      store.internal(entry.id, entry.preparation.generation, current => { current.preparation.steps[step].runId = captured.runId; });
    });
    const result = await ports.execute(captured, signal).settled;
    return result.data;
  };
  const process = async (initial: BoardEntry, signal: AbortSignal) => {
    const generation = initial.preparation.generation;
    while (!closed && !signal.aborted) {
      let entry = store.requireEntry(initial.id);
      if (entry.preparation.generation !== generation || entry.archived) return;
      const step = nextStep(entry);
      if (!step) { store.internal(entry.id,generation,current => { current.preparation.status = 'ready'; }); return; }
      entry = store.internal(entry.id,generation,current => {
        current.preparation.status = 'running'; current.preparation.step = step;
        const state = current.preparation.steps[step]; state.status = 'running'; state.attempts++; state.startedAt = now(); delete state.error;
      })!;
      try {
        if (step === 'fetch') {
          if (!entry.discovery.url) throw new OperationError('unreadable_source', 'The offer has no source URL. Paste its posting text to continue.');
          const source = await (ports.reader.capture ?? ports.reader.resolve).call(ports.reader, entry.discovery.url, {traceId: `board:${entry.id}`, signal});
          if (!source.text.trim()) throw new OperationError('unreadable_source','No posting text was returned. Paste the posting text to continue.');
          if (closed || signal.aborted) return;
          checkpoint(entry.id,generation,step,current => {
            const warnings = [...(source.extractionWarnings ?? []), ...(source.contentTruncated ? ['The source capture was truncated.'] : [])];
            const posting = {...source, id: randomUUID(), capturedAt: now(), provenance: 'source' as const, completeness: source.contentTruncated || warnings.length ? 'partial' as const : 'complete' as const, warnings};
            current.postings.push(posting); current.currentPostingId = posting.id;
          });
        } else if (step === 'language') {
          const posting = currentPosting(entry)!;
          const text = offerLanguageText(posting.descriptionText ?? posting.text);
          const result = text ? await runStep(entry,step,'detect_offer_language',{text},signal)
            : { detected: 'unknown', uncertain: true, reason: 'No substantive job description was captured.' };
          if (closed || signal.aborted) return;
          const detected = String(result.detected ?? 'unknown').toLowerCase();
          checkpoint(entry.id,generation,step,current => {
            current.language = { detected, uncertain: result.uncertain !== false, reason: String(result.reason ?? ''), detectedAt: now() };
            // An automatic context belongs to the previous detection. Only an
            // explicit language choice survives a newly captured posting.
            if (!current.languageOverride) delete current.selectedContextId;
          });
        } else if (step === 'copyCv') {
          const language = entry.languageOverride ?? (entry.language?.uncertain ? undefined : entry.language?.detected);
          const context = entry.selectedContextId ? ports.contexts().find(item => item.id === entry.selectedContextId) : ports.contexts().find(item => item.language === language);
          if ((!entry.selectedContextId && language !== 'pl' && language !== 'en') || !context?.language) throw new OperationError('selection_required','Confirm the posting language and select a Profile CV to continue.');
          const captured = ports.captureCv(context.id);
          const body = captured.document.body;
          if (!hasText(body)) throw new OperationError('selection_required','The selected CV is empty. Complete it in Profile, then resume preparation.');
          checkpoint(entry.id,generation,step,current => {
            current.selectedContextId = context.id;
            store.addCv(current, {...captured, reason: 'profile', document: {...captured.document, id: `board:${entry.id}`, revision: current.cvs.length + 1}});
          });
        } else if (step === 'analyze') {
          const posting = currentPosting(entry)!;
          const result = await runStep(entry,step,'analyze_offer',{offerText: posting.text.slice(0,100000), stated: posting.stated},signal);
          if (closed || signal.aborted) return;
          checkpoint(entry.id,generation,step,current => { current.preparation.steps.analyze.result = result; });
        } else {
          const cv = currentCv(entry);
          if (!cv) throw new OperationError('selection_required','Select a CV before tailoring its Summary.');
          const analysis = entry.preparation.steps.analyze.result ?? {};
          const result = await runStep(entry,step,'generate_evidence_summary',{offer: analysis, language: cv.sourceContext.language},signal);
          if (closed || signal.aborted) return;
          if (typeof result.summary !== 'string' || !result.summary.trim()) throw new OperationError('invalid_summary','The model returned no valid Summary. Retry or edit the Summary manually.');
          checkpoint(entry.id,generation,step,current => {
            if (current.currentCvId !== cv.id) throw new OperationError('board_conflict','The CV changed during tailoring. Your edit was preserved.');
            store.addCv(current,{...cv, reason: 'tailored', document: {...cv.document, revision: current.cvs.length + 1, updatedAt: now(), body: {...cv.document.body, role_description: result.summary}}, evidence: result});
          });
        }
      } catch (error) {
        if (closed || signal.aborted) return;
        const code = error instanceof OperationError || error instanceof RuntimeError ? (error.code === 'context_not_found' ? 'selection_required' : error.code) : 'step_failed';
        const message = error instanceof Error ? error.message : 'Preparation failed.';
        store.internal(entry.id,generation,current => {
          const state = current.preparation.steps[step]; state.status = 'failed'; state.error = message;
          current.preparation.error = message; current.preparation.code = code;
          const retryable = ['step_failed','timeout','provider_unavailable','network_error'].includes(code) && state.attempts < 3;
          current.preparation.status = retryable ? 'queued' : ['selection_required','unreadable_source','browser_capture_required','board_conflict'].includes(code) ? 'waiting' : 'failed';
          if (retryable) current.preparation.retryAt = now() + [1000,5000,30000][Math.min(state.attempts - 1,2)]!;
          boardEvent(current,'preparationFailed',{step,code,message,willRetry:retryable},now());
        });
        return;
      }
    }
  };
  const schedule = () => { if (!closed && !timer) { timer = setTimeout(() => {timer=undefined;pump();},500); timer.unref(); } };
  const pump = () => {
    if (closed) return;
    for (const entry of store.queued(now())) {
      if (active.size >= 2) break;
      if (entry.archived || active.has(entry.id) || entry.preparation.status !== 'queued' || (entry.preparation.retryAt ?? 0) > now()) continue;
      const controller = new AbortController(); active.set(entry.id,{controller,generation:entry.preparation.generation});
      void process(entry,controller.signal).catch(() => undefined).finally(() => {active.delete(entry.id);schedule();});
    }
    schedule();
  };
  const recoverChats = (entryId: string) => {
    const messages = store.chatMessages(entryId);
    for (const input of store.runsFor(entryId).filter(input => input.step === 'chat')) {
      const run = ports.run(input.runId);
      if (run?.status === 'succeeded' && !messages.some(message => message.runId === input.runId && message.role === 'assistant')) {
        store.appendChat(entryId,{id:randomUUID(),role:'assistant',text:String(run.result?.answer ?? ''),createdAt:run.endedAt ?? now(),runId:run.id,contextRevision:input.generation});
      }
    }
  };
  const launchChat = (input: BoardRunInput) => {
    if(chats.has(input.runId)) return;
    const state={controller:new AbortController(),text:'',entryId:input.entryId};chats.set(input.runId,state);
    try {
      const handle=ports.execute(input,state.controller.signal,text=>{state.text=(state.text+text).slice(0,100000);});
      void handle.settled.then(()=>{if(!closed && !state.controller.signal.aborted && store.get(input.entryId))recoverChats(input.entryId);}).catch(()=>undefined).finally(()=>chats.delete(input.runId));
    } catch(error) {chats.delete(input.runId);throw error;}
  };
  schedule();
  return {
    ...store,
    add(request: Parameters<typeof store.add>[0]) { const entry=store.add(request);pump();return entry; },
    control(request: Control) {
      const entry=store.mutate(request,'control',entry => {
        const prep=entry.preparation;
        if (request.action === 'pause') {prep.status='paused';prep.generation++;}
        else if (request.action === 'refreshPosting') resetFrom(entry,'fetch');
        else if (request.action === 'refreshCv') resetFrom(entry,'copyCv');
        else if (request.action === 'regenerate') resetFrom(entry,'summary');
        else if (request.action === 'prepare' && prep.status === 'notStarted') resetFrom(entry,'fetch');
        else {prep.generation++;prep.status='queued';delete prep.error;delete prep.code;delete prep.retryAt;const step=nextStep(entry);if(step) prep.steps[step].attempts=0;}
        boardEvent(entry,'preparationControl',{action:request.action},now());
      });
      abortOutdated(entry.id);pump();return entry;
    },
    configure(request: BoardWrite & { language?: 'pl' | 'en'; contextId?: string; postingText?: string }) {
      const entry=store.mutate(request,'configure',entry => {
        if(request.language) { entry.languageOverride=request.language; if(!request.contextId) delete entry.selectedContextId; }
        if(request.contextId) {
          const context = ports.contexts().find(item => item.id === request.contextId);
          if (!context?.language || (request.language && request.language !== context.language)) throw new OperationError('selection_required','Select a matching Polish or English Profile CV.');
          entry.selectedContextId=request.contextId;
          entry.languageOverride=context.language;
        }
        if(request.postingText !== undefined) {
          const posting={id:randomUUID(),url:entry.discovery.url ?? '',finalUrl:entry.discovery.url ?? '',text:request.postingText,capturedAt:now(),provenance:'manual' as const,completeness:'partial' as const,warnings:['Posting text supplied manually.']};
          entry.postings.push(posting);entry.currentPostingId=posting.id;resetFrom(entry,'language');
          entry.preparation.steps.fetch={status:'complete',attempts:0,completedAt:now()};
        } else if (entry.currentPostingId) resetFrom(entry,'copyCv'); else resetFrom(entry,'fetch');
        boardEvent(entry,'contextConfigured',{language:request.language ?? null,contextId:request.contextId ?? null,manualPosting:request.postingText !== undefined},now());
      });abortOutdated(entry.id);pump();return entry;
    },
    updateSummary(request: BoardWrite & {summary: string; cvVersionId: string}) {
      const entry=store.mutate(request,'summary',entry => {
        const cv=currentCv(entry);
        if(!cv || cv.id !== request.cvVersionId) throw new OperationError('board_conflict','The CV changed while the Summary editor was open.');
        store.addCv(entry,{...cv,reason:'manual',document:{...cv.document,revision:entry.cvs.length+1,updatedAt:now(),body:{...cv.document.body,role_description:request.summary}},evidence:undefined});
        entry.preparation.generation++;entry.preparation.status='ready';delete entry.preparation.error;delete entry.preparation.code;
        entry.preparation.steps.summary={status:'complete',attempts:0,completedAt:now()};
      });abortOutdated(entry.id);return entry;
    },
    saveAnswers(request: BoardWrite & {answers: BoardAnswer[]}) { return store.mutate(request,'answers',entry => {entry.answers=request.answers;boardEvent(entry,'answersEdited',{answers:request.answers},now());}); },
    addNote(request: BoardWrite & {text: string; at: number}) {return store.mutate(request,'note',entry => {boardEvent(entry,'note',{text:request.text},request.at);});},
    setStage(request: BoardWrite & {stage: ApplicationStage; note?: string}) {return store.mutate(request,'stage',entry => {const from=entry.applicationStage;entry.applicationStage=request.stage;boardEvent(entry,'applicationStage',{from,to:request.stage,note:request.note ?? ''},now());});},
    drop(request: BoardWrite) {
      const result = store.drop(request);
      ports.onDrop?.(request.entryId);
      active.get(request.entryId)?.controller.abort();
      for (const chat of chats.values()) if (chat.entryId === request.entryId) chat.controller.abort();
      return result;
    },
    chatSend(request: {entryId: string; runId: string; question: string}) {
      if(closed) throw new OperationError('unavailable','Board chat is closed.');
      const previous=store.getRun(request.runId);
      if(previous) {
        if(previous.entryId!==request.entryId || previous.step!=='chat' || previous.input.question!==request.question) throw new OperationError('operation_conflict','This run ID belongs to another question.');
        if(!ports.run(previous.runId)) launchChat(previous);
        return {runId:request.runId};
      }
      if([...chats.values()].some(chat=>chat.entryId===request.entryId)) throw new OperationError('board_busy','Wait for the current reply before sending another question.');
      recoverChats(request.entryId);
      const entry=store.requireEntry(request.entryId), captured=snapshot(entry);
      const history=store.chatMessages(entry.id).slice(-16).map(message=>({role:message.role,text:message.text}));
      const application={applicationStage:entry.applicationStage,answers:entry.answers,submissions:entry.submissions,history:entry.history,artifacts:entry.artifacts};
      const input: BoardRunInput={runId:request.runId,entryId:entry.id,generation:entry.revision,step:'chat',capability:'ask_profile',snapshot:captured,application,
        input:{question:request.question,history,summary:'',offerText:captured.offer.text.slice(0,100000),boardContext:JSON.stringify({...application,history:entry.history.slice(-100),omittedHistoryEvents:Math.max(0,entry.history.length-100),notes:entry.history.filter(event=>event.type==='note')}).slice(0,150000)}};
      store.transaction(()=>{store.storeRun(input);store.appendChat(entry.id,{id:randomUUID(),role:'user',text:request.question,createdAt:now(),runId:request.runId,contextRevision:entry.revision});});
      launchChat(input);
      return {runId:request.runId};
    },
    chatGet(entryId: string) {
      recoverChats(entryId);
      const inputs=store.runsFor(entryId).filter(input=>input.step==='chat');
      const last=inputs.at(-1);const run=last?ports.run(last.runId):undefined;const streaming=last?chats.get(last.runId):undefined;
      return {messages:store.chatMessages(entryId),runId:last?.runId,status:streaming?'running':run?.status ?? (last?'failed':undefined),error:run?.errorMessage ?? (last && !run ? 'The previous question was interrupted before it started. Send it again.' : undefined),streamText:streaming?.text ?? ''};
    },
    chatCancel(entryId: string, runId: string) {if(store.getRun(runId)?.entryId!==entryId)throw new OperationError('board_conflict','This run belongs to another offer.');chats.get(runId)?.controller.abort();},
    close() {closed=true;if(timer)clearTimeout(timer);for(const running of active.values())running.controller.abort();for(const chat of chats.values())chat.controller.abort();}
  };
};
