/** Suggested first questions, chosen from the tools the signed-in user can actually use. */
const SUGGESTIONS: { prefix: string; read: string; write?: string }[] = [
  { prefix: 'bookings', read: 'What is booked today?', write: 'Help me cancel a booking' },
  { prefix: 'members', read: 'Find a member by name' },
  { prefix: 'courts', read: 'Which courts are free this evening?' },
  { prefix: 'orders', read: 'Show the latest shop orders' },
  { prefix: 'crm', read: 'Who enquired in the last week?', write: 'Add a new lead' },
  { prefix: 'reports', read: 'How did we do this week?' },
  { prefix: 'notifications', read: 'What are my unread notifications?', write: 'Mark all my notifications as read' },
];

export function suggestedPrompts(tools: { name: string; write: boolean }[], limit = 4): string[] {
  const reads: string[] = []; const writes: string[] = [];
  for (const entry of SUGGESTIONS) {
    const mine = tools.filter((tool) => tool.name.toLowerCase().startsWith(entry.prefix));
    if (mine.length === 0) continue;
    reads.push(entry.read);
    if (entry.write && mine.some((tool) => tool.write)) writes.push(entry.write);
  }
  const all = [...reads.slice(0, limit - Math.min(writes.length, 1)), ...writes.slice(0, 1)];
  return (all.length > 0 ? all : ['What can you help me with?']).slice(0, limit);
}
