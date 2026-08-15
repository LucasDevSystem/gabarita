export function BadgeDificuldade({ dificuldade }: { dificuldade: number | null }) {
  if (!dificuldade) return null;

  return (
    <div className="flex items-center gap-0.5" title={`Dificuldade ${dificuldade}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={
            i < dificuldade
              ? "bg-primary size-1.5 rounded-full"
              : "bg-muted-foreground/25 size-1.5 rounded-full"
          }
        />
      ))}
    </div>
  );
}
