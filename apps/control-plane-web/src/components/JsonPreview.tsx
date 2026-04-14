type Props = {
  data: unknown;
};

export function JsonPreview({ data }: Props) {
  if (!data) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
        暂无数据。
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-800/70 bg-slate-950 px-4 py-4 sm:px-5 sm:py-5">
      <pre className="code-block">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
