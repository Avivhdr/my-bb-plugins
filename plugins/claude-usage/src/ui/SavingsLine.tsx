import type { Projection } from "../advice";
import { formatMoney } from "../format";

/** What the next 10 messages cost as things stand, with the compacted price pointing at the button beside it. */
export function SavingsLine({ projection }: { projection: Projection }) {
  return (
    <span>
      Next {projection.messages} messages: <strong>~{formatMoney(projection.asIs)}</strong>{" "}
      <span className="text-muted-foreground">(~{formatMoney(projection.compacted)} if you compact now →)</span>
    </span>
  );
}
