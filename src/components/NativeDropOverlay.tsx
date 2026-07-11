type NativeDropOverlayProps = {
  active: boolean;
  itemCount: number;
};

export function NativeDropOverlay({ active, itemCount }: NativeDropOverlayProps) {
  if (!active) return null;
  return (
    <div className="native-drop-overlay" role="status" aria-label="文件拖放" aria-live="polite">
      <strong>松开以打开</strong>
      <span>{itemCount.toLocaleString()} 个项目</span>
    </div>
  );
}
