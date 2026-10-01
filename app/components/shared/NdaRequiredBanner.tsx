export function NdaRequiredBanner({ required }: { required: boolean }) {
  if (!required) return null;
  return (
    <div role="alert" className="rounded-lg border-2 border-amber-500 bg-amber-100 px-5 py-4 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100">
      <p className="font-bold">NDA required</p>
      <p className="text-sm">Customer parts and project details must not be used for marketing.</p>
    </div>
  );
}
