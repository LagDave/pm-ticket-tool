/**
 * The rotating loader copy (§4.2: named, not magic). One shared pool used by the
 * single ThinkingLoader everywhere the app waits (batch generation, triage,
 * session-list load, feature-scope load). Most lines star "Dave", our long
 * suffering engineer, turning the wait into a little story; the rest narrate
 * what the tool is actually doing (reading the request, grounding in the
 * codebase, drafting criteria). Funny, but each one still makes sense for "the
 * tool is thinking". No em-dashes anywhere (house rule); keep each line short so
 * it fits the serif title on one or two lines.
 */

/** The full message pool. ~50 lines, weighted toward Dave. */
export const LOADING_MESSAGES: readonly string[] = [
  // Dave, doing the work
  "Dave is reading your request…",
  "Dave is grepping the codebase…",
  "Dave is checking your specs against the codebase…",
  "Dave is thinking about what to clarify…",
  "Dave found something confusing, writing it down…",
  "Dave is turning your idea into a ticket…",
  "Dave is drafting the next questions…",
  "Dave is cross-referencing your earlier answers…",
  "Dave is writing a Given, When, Then…",
  "Dave is counting the edge cases…",
  "Dave is reading the acceptance criteria twice…",
  "Dave is sizing this up in story points…",
  "Dave is looking for where this actually lives…",
  "Dave is checking if this is a one-liner or a project…",
  "Dave found three ways to do this, picking one…",
  "Dave is reading between the lines…",
  "Dave is double-checking the happy path…",
  "Dave is making sure this fits the sprint…",
  "Dave is untangling the requirements…",
  "Dave is sanity-checking the estimate…",
  // Dave, being Dave
  "Dave is putting down his coffee…",
  "Dave renamed a variable for the third time…",
  "Dave is arguing with the linter…",
  "Dave found a TODO from 2019…",
  "Dave is rebasing, please hold…",
  "Dave swears it worked on his machine…",
  "Dave is waiting on his hot reload…",
  "Dave is blaming the cache…",
  "Dave is asking the rubber duck for a second opinion…",
  "Dave is pretending he read the whole file…",
  "Dave is resisting the urge to refactor everything…",
  "Dave is closing forty browser tabs…",
  "Dave is googling the error he just wrote…",
  "Dave is muttering about scope creep…",
  "Dave is naming things, the genuinely hard problem…",
  "Dave is checking the git blame, gently…",
  "Dave promised this would be quick…",
  "Dave is one more coffee from a breakthrough…",
  // The tool, narrating honestly
  "Warming up the question engine…",
  "Scanning the repository for context…",
  "Grounding the options in your codebase…",
  "Reading your answers so far…",
  "Connecting the dots in your request…",
  "Weighing the open product decisions…",
  "Choosing the fastest sensible path…",
  "Tidying up the next batch…",
  "Lining up the trade-offs…",
  "Turning vague into specific…",
  "Consulting the existing patterns…",
  "Almost there, polishing the details…",
];

/**
 * A shuffled copy of the pool (Fisher-Yates). Called once per loader mount so
 * each wait starts on a different line and cycles without immediate repeats.
 * Math.random is fine in browser UI code; this is presentation, not logic.
 */
export function shuffledMessages(): string[] {
  const out = [...LOADING_MESSAGES];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
