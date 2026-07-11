import { forwardRef, type Ref } from "react";

export type ActiveUtility = "outline" | "knowledge" | "assistant" | null;

type UtilityLauncherProps = {
  activeUtility: ActiveUtility;
  showOutline: boolean;
  showKnowledge: boolean;
  onToggle: (utility: Exclude<ActiveUtility, null>) => void;
  outlineRef?: Ref<HTMLButtonElement>;
  knowledgeRef?: Ref<HTMLButtonElement>;
  assistantRef?: Ref<HTMLButtonElement>;
};

export const UtilityLauncher = forwardRef<HTMLDivElement, UtilityLauncherProps>(function UtilityLauncher(
  { activeUtility, showOutline, showKnowledge, onToggle, outlineRef, knowledgeRef, assistantRef },
  ref,
) {
  return (
    <div ref={ref} className="utility-launcher" aria-label="文档工具">
      {showOutline && (
        <button
          ref={outlineRef}
          type="button"
          aria-label="打开大纲"
          aria-expanded={activeUtility === "outline"}
          onClick={() => onToggle("outline")}
        >
          大纲
        </button>
      )}
      {showKnowledge && (
        <button
          ref={knowledgeRef}
          type="button"
          aria-label="打开知识"
          aria-expanded={activeUtility === "knowledge"}
          onClick={() => onToggle("knowledge")}
        >
          知识
        </button>
      )}
      <button
        ref={assistantRef}
        type="button"
        aria-label="打开 AI 助手"
        aria-expanded={activeUtility === "assistant"}
        onClick={() => onToggle("assistant")}
      >
        AI
      </button>
    </div>
  );
});
