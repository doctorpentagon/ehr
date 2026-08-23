import React from 'react';

function InlineText({ value }) {
  const parts = String(value || '').split(/(\*\*[^*]+\*\*|_[^_]+_|\+\+[^+]+\+\+)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('_') && part.endsWith('_')) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith('++') && part.endsWith('++')) return <u key={index}>{part.slice(2, -2)}</u>;
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

/**
 * Render the deliberately small formatting vocabulary supported by the
 * clinical editor. React escapes every text fragment, so pasted notes never
 * become executable HTML.
 */
export default function ClinicalText({ value, className = '' }) {
  return (
    <div className={`space-y-1 ${className}`}>
      {String(value || '').split('\n').map((line, index) => {
        const bullet = line.match(/^\s*•\s+(.*)$/);
        const numbered = line.match(/^\s*(\d+)\.\s+(.*)$/);
        if (bullet) {
          return <div key={index} className="flex gap-2"><span aria-hidden="true">•</span><span><InlineText value={bullet[1]} /></span></div>;
        }
        if (numbered) {
          return <div key={index} className="flex gap-2"><span className="tabular-nums">{numbered[1]}.</span><span><InlineText value={numbered[2]} /></span></div>;
        }
        return line ? <p key={index}><InlineText value={line} /></p> : <div key={index} className="h-2" />;
      })}
    </div>
  );
}
