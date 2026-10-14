"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { BuildProgressPanel } from "@/components/BuildProgressPanel";
import { DocHistoryButton } from "@/components/DocHistoryButton";
import { SourcesPanel } from "@/components/SourcesPanel";
import { SoundToggle } from "@/components/SoundToggle";
import { SpaceMapPanel } from "@/components/SpaceMapPanel";
import { SpacePicker } from "@/components/SpacePicker";
import { StatsPanel } from "@/components/StatsPanel";
import { AskPanel, type AskItem } from "@/components/dsl/AskPanel";
import { AttemptContext, postAttempt } from "@/components/dsl/attempt-context";
import { ensureAudio, playDone } from "@/lib/audio/sound";
import { ExplainDocView } from "@/components/dsl/ExplainDocView";
import { listDocs, loadDoc as loadDocById, streamExplanation, type DocSummary, type VersionPayload } from "@/lib/api/explanation";
import {
  CUSTOM_PERSONA_ID,
  PERSONA_STORAGE_KEY,
  PERSONAS,
  resolvePersonaHint,
  type PersonaState,
} from "@/lib/persona";
import {
  listSpaces,
  type SpaceInfo,
} from "@/lib/api/spaces";
import { usePartialDoc } from "@/hooks/usePartialDoc";
import { computeDeepens } from "@/lib/dsl/deepen";
import type { ExplainDoc } from "@/lib/dsl/schema";

const EXAMPLE_CONCEPTS = ["正弦波的频率", "傅里叶级数", "柱状图", "供需与价格"];
const REFINE_EXAMPLES = [
  "深入讲解最核心的概念",
  "加一个现实中的类比例子",
  "出两道自测题",
  "加一个对比演示",
];

export default function Home() {
  const [concept, setConcept] = useState("");
  const [webSearchOn, setWebSearchOn] = useState(true);
  const [attachedSourceIds, setAttachedSourceIds] = useState<number[]>([]);
  const [spaces, setSpaces] = useState<SpaceInfo[]>([]);
  const [spaceId, setSpaceId] = useState<number | null>(null);
  /** 出身概念：从资料提炼点/概念地图进入生成时记录，地图据此对齐讲解 */
  const [originConcept, setOriginConcept] = useState<string | null>(null);
  /** 空间地图刷新信号：生成完成/切换文档后自增 */
  const [mapRefresh, setMapRefresh] = useState(0);
  const [persona, setPersona] = useState<PersonaState>({ id: "default", custom: "" });
  const [doc, setDoc] = useState<ExplainDoc | null>(null);
  const [docId, setDocId] = useState<number | null>(null);
  const [restoredAsks, setRestoredAsks] = useState<AskItem[]>([]);
  const [versions, setVersions] = useState<VersionPayload[]>([]);
  const [busy, setBusy] = useState<null | "generate" | "refine">(null);
  const [buildText, setBuildText] = useState("");
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [refineInput, setRefineInput] = useState("");
  const [refineError, setRefineError] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<"refine" | "ask">("refine");

  const [docList, setDocList] = useState<DocSummary[]>([]);
  const [loadingDoc, setLoadingDoc] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const refreshSpaces = () => {
    listSpaces()
      .then((list) => {
        setSpaces(list);
        // 已删/不存在的空间回落全局
        setSpaceId((current) => (current !== null && !list.some((s) => s.id === current) ? null : current));
      })
      .catch(() => {});
  };

  useEffect(() => {
    listDocs().then(setDocList).catch(() => {});
    refreshSpaces();
    // 恢复上次所在空间（不存在则回落全局）
    try {
      const saved = localStorage.getItem("gewu-space");
      if (saved !== null) setSpaceId(/^\d+$/.test(saved) ? Number(saved) : null);
    } catch {
      // 损坏存储忽略
    }
    // 恢复附加的资料工作集（SourcesPanel 挂载取列表后会对账修剪失效 id）。
    // 持久化不走 effect 写回：StrictMode 双挂载下初始空态会把存储清掉（实测），
    // 改为各变更入口（updateAttached）直接写存储，恢复只读
    try {
      const raw = localStorage.getItem("gewu-attached");
      if (raw !== null) {
        const ids = JSON.parse(raw) as unknown;
        if (Array.isArray(ids)) {
          setAttachedSourceIds(
            ids.filter((v): v is number => Number.isInteger(v) && v > 0).slice(0, 3)
          );
        }
      }
    } catch {
      // 损坏存储忽略
    }
  }, []);

  // 空间切换：持久化 + 历史列表按空间过滤
  useEffect(() => {
    try {
      localStorage.setItem("gewu-space", spaceId === null ? "" : String(spaceId));
    } catch {}
    listDocs(spaceId ?? undefined).then(setDocList).catch(() => {});
  }, [spaceId]);

  // 切换讲解后刷新地图（练习与讲解状态可能变化）
  useEffect(() => {
    if (spaceId !== null) setMapRefresh((k) => k + 1);
  }, [docId, spaceId]);

  // 人设持久化：挂载时读 localStorage（避免 SSR/客户端不一致）。写回不走 effect——
  // StrictMode 双挂载下初始默认态会清掉存储（同 gewu-attached 的实测竞态），改为变更处直写
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PERSONA_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as PersonaState;
      if (saved && typeof saved.id === "string") {
        setPersona({ id: saved.id, custom: typeof saved.custom === "string" ? saved.custom : "" });
      }
    } catch {
      // 损坏的存储忽略，回落默认
    }
  }, []);

  /** 人设唯一变更入口：改状态同时写 localStorage */
  function updatePersona(next: PersonaState) {
    setPersona(next);
    try {
      localStorage.setItem(PERSONA_STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }
  const personaHint = resolvePersonaHint(persona);

  function refreshDocList() {
    listDocs().then(setDocList).catch(() => {});
  }

  function cancel() {
    abortRef.current?.abort();
  }

  /** 附加资料的唯一变更入口：改状态同时写 localStorage（不落 effect，避开挂载期写回竞态） */
  function updateAttached(ids: number[]) {
    setAttachedSourceIds(ids);
    try {
      localStorage.setItem("gewu-attached", JSON.stringify(ids));
    } catch {}
  }

  // 流式上屏：生成期从累计原始文本派生部分文档（真块渐次上屏 + 尾部骨架）
  const partial = usePartialDoc(busy === "generate" ? buildText : null);
  const streamDoc = useMemo<ExplainDoc | null>(() => {
    if (!partial || partial.blocks.length === 0) return null;
    return {
      version: 1,
      title: partial.title || concept.trim() || "正在生成",
      blocks: partial.blocks,
    };
  }, [partial, concept]);

  // 双栏布局需要横向空间：文档/流式文档存在时放宽容器
  const wide = doc !== null || streamDoc !== null;

  // 深化链分段：由版本链派生（refine 追加语义下各轮 fromIndex 坐标一致）
  const deepens = useMemo(() => computeDeepens(versions), [versions]);

  // 练习判定上报通道：文档已落库（docId 存在）时提供；流式期/未落库不提供
  const attemptValue = useMemo(
    () =>
      docId !== null
        ? {
            docId,
            report: (blockType: "quiz" | "fillBlank" | "match" | "sort", correct: boolean) =>
              postAttempt(docId, blockType, correct),
          }
        : null,
    [docId]
  );

  /** 生成主流程（常规概念 / 统计面板触发的针对性补练共用） */
  async function runGenerate(conceptText: string, extra: { practiceDocId?: number } = {}) {
    if (busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    ensureAudio(); // 点击手势内预建 AudioContext，完成提示音不被自动播放策略拦截
    setBusy("generate");
    setError(null);
    setBuildText("");
    setSearchNote(null);
    try {
      const { doc: next, docId: id } = await streamExplanation(
        "generate",
        {
          concept: conceptText,
          webSearch: webSearchOn,
          personaStyle: personaHint,
          sourceIds: attachedSourceIds,
          spaceId,
          originConcept,
          ...extra,
        },
        {
          onDelta: (t) => setBuildText((prev) => prev + t),
          onInfo: (m) => setSearchNote(m),
          signal: controller.signal,
        }
      );
      setDoc(next);
      setDocId(id);
      setRestoredAsks([]);
      setVersions([{ blocks: next.blocks, instruction: null }]);
      setRefineInput("");
      setRefineError(null);
      refreshDocList();
      setMapRefresh((k) => k + 1);
      playDone();
    } catch (err) {
      if (controller.signal.aborted) setError("已取消本次生成");
      else setError(err instanceof Error ? err.message : "生成失败，请稍后重试");
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  function handleGenerate() {
    const text = concept.trim();
    // 附加了资料时概念可留空：服务端默认围绕第一份资料生成
    if ((!text && attachedSourceIds.length === 0) || busy) return;
    runGenerate(text);
  }

  /** 资料「提炼讲解点」点击：附加该资料并把概念填进生成框（记录出身概念供地图对齐） */
  function pickSourceConcept(conceptText: string, sourceId: number) {
    setConcept(conceptText);
    setOriginConcept(conceptText);
    setAttachedSourceIds((prev) => {
      const next = prev.includes(sourceId) ? prev : prev.length < 3 ? [...prev, sourceId] : prev;
      try {
        localStorage.setItem("gewu-attached", JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  /** 概念地图点击未学概念：附加其来源资料并预填（出身概念 = 概念名） */
  function pickMapConcept(conceptText: string, sourceIds: number[]) {
    setConcept(conceptText);
    setOriginConcept(conceptText);
    setAttachedSourceIds((prev) => {
      const merged = [...prev];
      for (const id of sourceIds) {
        if (!merged.includes(id) && merged.length < 3) merged.push(id);
      }
      try {
        localStorage.setItem("gewu-attached", JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }

  /** 统计面板弱项补练：以源概念标题生成针对性练习讲解 */
  function startPractice(docId: number, title: string) {
    if (busy) return;
    setConcept(title);
    runGenerate(title, { practiceDocId: docId });
  }

  async function handleRefine() {
    const instruction = refineInput.trim();
    const parentDoc = doc;
    if (!instruction || !parentDoc || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    ensureAudio();
    setBusy("refine");
    setRefineError(null);
    setBuildText("");
    try {
      const { doc: next, docId: id } = await streamExplanation(
        "refine",
        { doc: parentDoc, instruction, docId },
        {
          onDelta: (t) => setBuildText((prev) => prev + t),
          signal: controller.signal,
        }
      );
      // 父版本链就在闭包里：追加本轮版本，深化分段由 versions 派生
      setVersions((prev) => [...prev, { blocks: next.blocks, instruction }]);
      setDoc(next);
      setDocId(id);
      setRestoredAsks([]);
      setRefineInput("");
      refreshDocList();
      playDone();
    } catch (err) {
      if (controller.signal.aborted) setRefineError("已取消本次改造");
      else setRefineError(err instanceof Error ? err.message : "改造失败，请稍后重试");
    } finally {
      setBusy(null);
      abortRef.current = null;
    }
  }

  async function loadDoc(id: number) {
    if (!Number.isInteger(id) || id <= 0 || loadingDoc) return;
    setLoadingDoc(true);
    setError(null);
    try {
      const { doc: loaded, asks, versions: chain } = await loadDocById(id);
      setDoc(loaded);
      setDocId(id);
      setRestoredAsks(asks);
      setVersions(chain);
      setRefineError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "恢复讲解失败");
    } finally {
      setLoadingDoc(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-gradient-to-b from-indigo-50/70 via-zinc-50 to-zinc-50 px-4 py-10 font-sans">
      {/* 右上角标签组：学习统计 + 历史讲解 + 音效开关 */}
      <div className="fixed right-4 top-4 z-40 flex items-center gap-2">
        <SoundToggle />
        <StatsPanel onPractice={startPractice} spaceId={spaceId ?? undefined} />
        <DocHistoryButton
          docs={docList}
          currentId={docId}
          disabled={busy !== null || loadingDoc}
          onSelect={loadDoc}
        />
      </div>
      <main className={`w-full ${wide ? "max-w-5xl" : "max-w-2xl"} transition-[max-width] duration-300`}>
        <header className="mb-8 text-center">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-500 shadow-sm">
            <span className="font-medium text-zinc-700">格物</span> Gewu · 生成式交互讲解工坊
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
            输入一个概念，
            <span className="bg-gradient-to-r from-indigo-600 to-violet-500 bg-clip-text text-transparent">
              玩着懂
            </span>
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            AI 现场生成带滑块与图表的交互讲解——拖动参数建立直觉，追问深入细节，一句话继续改造
          </p>
        </header>

        {/* 生成入口 */}
        <section className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
          <div className="flex gap-2">
            <input
              value={concept}
              onChange={(e) => {
                setConcept(e.target.value);
                setOriginConcept(null); // 手动改写概念后出身对齐失效（地图按精确概念名匹配）
              }}
              onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              placeholder={
                attachedSourceIds.length > 0
                  ? "留空则围绕第一份资料生成，或输入具体概念"
                  : "想搞懂什么概念？如：傅里叶级数、柱状图、供需与价格"
              }
              maxLength={200}
              className="h-11 flex-1 rounded-xl border border-zinc-200 px-4 text-sm outline-none transition-colors focus:border-indigo-400"
              disabled={busy === "generate"}
            />
            <button
              onClick={handleGenerate}
              disabled={busy !== null || (!concept.trim() && attachedSourceIds.length === 0)}
              className="h-11 rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              生成讲解
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {EXAMPLE_CONCEPTS.map((example) => (
              <button
                key={example}
                onClick={() => {
                  setConcept(example);
                  setOriginConcept(null);
                }}
                disabled={busy === "generate"}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
              >
                {example}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <SpacePicker
                spaces={spaces}
                spaceId={spaceId}
                onSpacesChange={refreshSpaces}
                onChange={setSpaceId}
                disabled={busy === "generate"}
              />
              <SourcesPanel
                attachedIds={attachedSourceIds}
                onAttachChange={updateAttached}
                onPickConcept={pickSourceConcept}
                spaceId={spaceId}
                disabled={busy === "generate"}
              />
              <select
                value={persona.id}
                onChange={(e) => updatePersona({ id: e.target.value, custom: persona.custom })}
                disabled={busy === "generate"}
                title="讲解与追问的语气人设"
                className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 outline-none transition-colors hover:border-indigo-300 focus:border-indigo-400 disabled:opacity-50"
              >
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM_PERSONA_ID}>自定义</option>
              </select>
              {persona.id === CUSTOM_PERSONA_ID && (
                <input
                  value={persona.custom}
                  onChange={(e) => updatePersona({ id: persona.id, custom: e.target.value })}
                  placeholder="一句话描述人设…"
                  maxLength={100}
                  disabled={busy === "generate"}
                  className="w-36 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs text-zinc-600 outline-none transition-colors focus:border-indigo-400 disabled:opacity-50"
                />
              )}
              <button
                type="button"
                onClick={() => setWebSearchOn((v) => !v)}
                aria-pressed={webSearchOn}
                disabled={busy === "generate"}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-50 ${
                  webSearchOn
                    ? "border-indigo-300 bg-indigo-50 text-indigo-600"
                    : "border-zinc-200 text-zinc-400 hover:text-zinc-600"
                }`}
                title="生成前用博查检索网络资料补充事实依据"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${webSearchOn ? "bg-indigo-500" : "bg-zinc-300"}`}
                />
                联网检索
              </button>
            </div>
          </div>

          {busy === "generate" && (
            <BuildProgressPanel raw={buildText} phase="generate" note={searchNote} onCancel={cancel} />
          )}
          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </section>

        {/* 空间模式：概念地图驾驶舱（资料提炼概念 × 讲解/练习状态，一键生成/打开/补练） */}
        {spaceId !== null && (
          <SpaceMapPanel
            spaceId={spaceId}
            refreshKey={mapRefresh}
            disabled={busy !== null}
            onPick={pickMapConcept}
            onPractice={startPractice}
            onOpenDoc={loadDoc}
          />
        )}

        {/* 讲解文档：生成期流式上屏（真块 + 尾骨架）；其余时间展示当前文档。
            无 exit 等待：refine 期间旧文档保留至 done 换新键 */}
        {streamDoc && busy === "generate" ? (
          <motion.section
            key="streaming"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 140, damping: 18 }}
            className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
          >
            <ExplainDocView
              doc={streamDoc}
              skeletonTail={[...partial!.pending, partial!.lastType ?? "text"]}
            />
          </motion.section>
        ) : doc && docId !== null ? (
          <motion.section
            key={docId}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 140, damping: 18 }}
            className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
          >
            <AttemptContext.Provider value={attemptValue}>
            <ExplainDocView doc={doc} deepens={deepens} />

            {/* 底部对话面板：深化讲解｜追问细节 双 tab（双份内容常驻 hidden 切换，保住追问会话态） */}
            <div className="mt-6 border-t border-zinc-100 pt-4">
              <div className="mb-3 flex w-fit gap-1 rounded-xl bg-zinc-100 p-1">
                {(
                  [
                    ["refine", "深化讲解"],
                    ["ask", "追问细节"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setBottomTab(value)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                      bottomTab === value
                        ? "bg-white font-medium text-zinc-800 shadow-sm"
                        : "text-zinc-500 hover:text-zinc-700"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className={bottomTab === "refine" ? "" : "hidden"}>
                <div className="flex flex-wrap gap-2">
                  {REFINE_EXAMPLES.map((example) => (
                    <button
                      key={example}
                      onClick={() => setRefineInput(example)}
                      disabled={busy === "refine"}
                      className="rounded-full border border-zinc-200 px-3 py-1 text-xs text-zinc-500 transition-colors hover:border-indigo-300 hover:text-indigo-600 disabled:opacity-50"
                    >
                      {example}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    value={refineInput}
                    onChange={(e) => setRefineInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleRefine()}
                    placeholder="或直接输入你想要的深化方向"
                    maxLength={300}
                    className="h-10 flex-1 rounded-xl border border-zinc-200 px-3 text-sm outline-none transition-colors focus:border-indigo-400"
                    disabled={busy === "refine"}
                  />
                  <button
                    onClick={handleRefine}
                    disabled={busy !== null || !refineInput.trim()}
                    className="h-10 rounded-xl border border-indigo-200 bg-indigo-50 px-4 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === "refine" ? "改造中…" : "深化"}
                  </button>
                </div>
                {busy === "refine" && (
                  <BuildProgressPanel raw={buildText} phase="refine" onCancel={cancel} />
                )}
                {refineError && (
                  <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                    {refineError}
                  </p>
                )}
              </div>

              <div className={bottomTab === "ask" ? "" : "hidden"}>
                <AskPanel docId={docId} initialAsks={restoredAsks} personaStyle={personaHint} />
              </div>
            </div>
            </AttemptContext.Provider>
          </motion.section>
        ) : null}

        <footer className="mt-10 text-center text-xs text-zinc-400">
          格物 Gewu · 传智杯 AI 创新应用挑战赛（Vibe Coding）作品
        </footer>
      </main>
    </div>
  );
}
