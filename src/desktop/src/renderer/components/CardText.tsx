import { symbolUrl } from '@commander-brawl/infrastructure/browser';
import type { ReactNode } from 'react';
import { keywordExplanation } from '../keywords';

/**
 * Card text with symbols like {2}{U} or {T} drawn as pictures, and one paragraph per line. The card's keywords are
 * marked, with what they mean when the pointer is on them.
 */
export function CardText({
  text,
  className,
  keywords = [],
}: {
  readonly text: string;
  readonly className?: string;
  readonly keywords?: readonly string[];
}) {
  if (!text) return null;
  const explained = keywords.filter((keyword) => keywordExplanation(keyword));
  return (
    <div className={className}>
      {text.split('\n').map((line, index) => (
        <p key={index}>
          <Symbols text={line} keywords={explained} />
        </p>
      ))}
    </div>
  );
}

export function Symbols({ text, keywords = [] }: { readonly text: string; readonly keywords?: readonly string[] }) {
  return (
    <>
      {text
        .split(/(\{[^}]+\})/)
        .map((part, index) =>
          /^\{[^}]+\}$/.test(part) ? (
            <img key={index} className="symbol" src={symbolUrl(part)} alt={part} title={part} />
          ) : (
            <MarkedKeywords key={index} text={part} keywords={keywords} />
          ),
        )}
    </>
  );
}

/** The keywords in a stretch of text, marked with what they mean; the rest as it is. */
function MarkedKeywords({ text, keywords }: { readonly text: string; readonly keywords: readonly string[] }) {
  if (keywords.length === 0) return <>{text}</>;
  // Longest first, so "First strike" is marked whole rather than "Strike" alone.
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`\\b(${sorted.map(escapeRegExp).join('|')})\\b`, 'gi');
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <abbr key={at} className="keyword" title={keywordExplanation(match[0])}>
        {match[0]}
      </abbr>,
    );
    last = at + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
