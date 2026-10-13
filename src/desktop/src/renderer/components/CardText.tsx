import { symbolUrl } from '@commander-brawl/infrastructure/browser';

/** Card text with symbols like {2}{U} or {T} drawn as pictures, and one paragraph per line. */
export function CardText({ text, className }: { readonly text: string; readonly className?: string }) {
  if (!text) return null;
  return (
    <div className={className}>
      {text.split('\n').map((line, index) => (
        <p key={index}>
          <Symbols text={line} />
        </p>
      ))}
    </div>
  );
}

export function Symbols({ text }: { readonly text: string }) {
  return (
    <>
      {text
        .split(/(\{[^}]+\})/)
        .map((part, index) =>
          /^\{[^}]+\}$/.test(part) ? (
            <img key={index} className="symbol" src={symbolUrl(part)} alt={part} title={part} />
          ) : (
            part
          ),
        )}
    </>
  );
}
