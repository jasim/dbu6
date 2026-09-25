/** The 28px green tile that stands for the app. */
export function Brand({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[8px] bg-primary font-bold text-primary-foreground"
      style={{ width: size, height: size, fontSize: size / 2 }}
    >
      d
    </span>
  );
}
