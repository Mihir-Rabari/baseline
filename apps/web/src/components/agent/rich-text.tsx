import React from 'react';

/** Renders **bold** spans as elements; every other character stays plain text, so markup in a message is never parsed. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4
      ? <strong key={`${keyPrefix}-${index}`} className="font-semibold">{part.slice(2, -2)}</strong>
      : <React.Fragment key={`${keyPrefix}-${index}`}>{part}</React.Fragment>);
}

type Block = { type: 'p'; lines: string[] } | { type: 'ul' | 'ol'; items: string[] };

export function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  for (const line of content.replace(/\r\n?/g, '\n').split('\n')) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const last = blocks[blocks.length - 1];
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      const text = (bullet ?? numbered)![1];
      if (last?.type === type) last.items.push(text); else blocks.push({ type, items: [text] });
    } else if (line.trim() === '') {
      blocks.push({ type: 'p', lines: [] });
    } else if (last?.type === 'p') last.lines.push(line);
    else blocks.push({ type: 'p', lines: [line] });
  }
  return blocks.filter((block) => block.type !== 'p' || block.lines.length > 0);
}

/** Plain text with line breaks, simple lists and bold. No HTML is ever interpreted. */
export function RichText({ content }: { content: string }) {
  return <div className="space-y-2 break-words">{parseBlocks(content).map((block, index) => {
    if (block.type === 'p') return <p key={index}>{block.lines.map((line, i) => <React.Fragment key={i}>{i > 0 && <br />}{inline(line, `${index}-${i}`)}</React.Fragment>)}</p>;
    const List = block.type;
    return <List key={index} className={block.type === 'ul' ? 'list-disc space-y-1 pl-5' : 'list-decimal space-y-1 pl-5'}>
      {block.items.map((item, i) => <li key={i}>{inline(item, `${index}-${i}`)}</li>)}</List>;
  })}</div>;
}
