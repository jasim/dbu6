import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "./ui/button";

/**
 * Copies a prompt for the user's coding agent, and says so for two seconds.
 * Import, freeform import and Review offer one wherever the app can't go
 * further on its own.
 */
export function CopyPromptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      <Copy />
      {copied ? "Copied" : "Copy prompt"}
    </Button>
  );
}
