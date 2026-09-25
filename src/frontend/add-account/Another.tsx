import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { FocusCard, type FocusFrame } from "./FocusCard";

/**
 * Card 5, first run only: the account is in, and every account goes in
 * before any review, so card payments and transfers have somewhere to land.
 */
export function Another({
  frame,
  name,
  thatsAll,
  onAnother,
}: {
  frame: FocusFrame;
  /** The account just added; null while the books are read. */
  name: string | null;
  /** Where "That's all" goes: the next card of the first run. */
  thatsAll: string;
  onAnother: () => void;
}) {
  return (
    <FocusCard
      {...frame}
      title={name === null ? "Added." : `${name} added.`}
      lead="Add the cards you pay and accounts you move money to, so those payments land in the right place."
      actions={
        <>
          <Button
            variant="outline"
            render={<Link to={thatsAll} />}
            nativeButton={false}
          >
            That's all
          </Button>
          <Button onClick={onAnother}>Add another bank or card</Button>
        </>
      }
    />
  );
}
