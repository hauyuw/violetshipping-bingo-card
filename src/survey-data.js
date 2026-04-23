// Each question id and option id must be unique and stable — changing them
// after submissions exist will cause orphan picks.
window.SURVEY_QUESTIONS = [
  {
    id: 'q1',
    label: 'Canon Continuity',
    options: [
      { id: 'q1o1',  text: 'AU - Supernatural' },
      { id: 'q1o2',  text: 'AU - No Millennium Items' },
      { id: 'q1o3',  text: 'AU - Fantasy' },
      { id: 'q1o4',  text: 'AU - Science Fiction' },
      { id: 'q1o5',  text: 'AU - Historical Period' },
      { id: 'q1o6',  text: 'Crossover/Fusions' },
      { id: 'q1o7',  text: 'Pre-Canon' },
      { id: 'q1o8',  text: 'Season 0/Early Manga' },
      { id: 'q1o9',  text: 'Duelist Kingdom' },
      { id: 'q1o10', text: 'Battle City' },
      { id: 'q1o11', text: 'Filler Arcs' },
      { id: 'q1o12', text: 'Memory World' },
      { id: 'q1o13', text: 'Post-Canon' },
      { id: 'q1o14', text: 'Canon Divergence' },
    ],
  },
  {
    id: 'q2',
    label: 'Fic Metadata',
    options: [
      { id: 'q2o1',  text: '0 comments' },
      { id: 'q2o2',  text: '<10 comments' },
      { id: 'q2o3',  text: '<= 1,000 words' },
      { id: 'q2o4',  text: '<= 5,000 words' },
      { id: 'q2o5',  text: '<= 10,000 words' },
      { id: 'q2o6',  text: '>= 10,000 words' },
      { id: 'q2o7',  text: 'Posted/updated within the last month' },
      { id: 'q2o8',  text: 'Posted/updated within the last 6 months' },
      { id: 'q2o9',  text: 'Posted/updated more than a year ago' },
      { id: 'q2o10', text: 'Posted before 2020' },
      { id: 'q2o11', text: 'Posted before 2015' },
      { id: 'q2o12', text: 'Posted before 2010' },
      { id: 'q2o13', text: 'Incomplete/Work-in-Progress' },
      { id: 'q2o14', text: 'Multichapter fic' },
      { id: 'q2o15', text: 'Oneshot' },
      { id: 'q2o16', text: 'Not posted on AO3' },
    ],
  },
  {
    id: 'q3',
    label: 'AO3 Specific',
    options: [
      { id: 'q3o1', text: 'By Anonymous' },
      { id: 'q3o2', text: 'Archive-locked fic' },
      { id: 'q3o3', text: 'Warning: Major Character Death' },
      { id: 'q3o4', text: 'Warning: Graphic Depiction of Violence' },
      { id: 'q3o5', text: 'Warning: Rape/Non-con' },
      { id: 'q3o6', text: 'Warning: Underage Sex' },
    ],
  },
  {
    id: 'q4',
    label: 'Tropes, Motifs, & Themes',
    options: [
      { id: 'q4o1',  text: 'Dragons' },
      { id: 'q4o2',  text: 'Duel Monsters/Professional dueling' },
      { id: 'q4o3',  text: 'Fake relationship' },
      { id: 'q4o4',  text: 'Time or dimensional travel' },
      { id: 'q4o5',  text: 'Pining' },
      { id: 'q4o6',  text: 'Omegaverse' },
      { id: 'q4o7',  text: 'Soulmate bonds/marks' },
      { id: 'q4o8',  text: 'Slow burn' },
      { id: 'q4o9',  text: 'Bodyguard' },
      { id: 'q4o10', text: 'Pre-slash' },
      { id: 'q4o11', text: 'Getting together' },
      { id: 'q4o12', text: 'Established relationship' },
      { id: 'q4o13', text: 'Going on a date' },
      { id: 'q4o14', text: 'Meeting the family' },
      { id: 'q4o15', text: 'Holidays' },
      { id: 'q4o16', text: 'Birthdays' },
      { id: 'q4o17', text: 'Proposals and weddings' },
      { id: 'q4o18', text: 'Love confession' },
      { id: 'q4o19', text: 'Past lives' },
      { id: 'q4o20', text: 'MPreg/raising kids' },
      { id: 'q4o21', text: 'Break-up/divorce' },
      { id: 'q4o22', text: 'Cooking, baking, and eating' },
      { id: 'q4o23', text: 'LGBTQ+ themes' },
    ],
  },
  {
    id: 'q5',
    label: 'Genres',
    options: [
      { id: 'q5o1', text: 'Humor/Crack' },
      { id: 'q5o2', text: 'Romance/Romcom' },
      { id: 'q5o3', text: 'Fluff' },
      { id: 'q5o4', text: 'Whump or Hurt/Comfort' },
      { id: 'q5o5', text: 'Angst/Tragedy' },
      { id: 'q5o6', text: 'Horror' },
      { id: 'q5o7', text: 'Smut/PWP' },
    ],
  },
];

// ── Card generation settings ──────────────────────────────────────────────────

// Text shown in the FREE cell (center of Mini and Standard cards).
// Must match the FREE_CELL_TEXT secret set in Supabase Edge Function secrets.
window.FREE_CELL_TEXT = 'Free Space ✦';

// ── Tumblr delivery settings ──────────────────────────────────────────────────

// Tags added to every Tumblr post. Edit the array.
window.CARD_TAGS = ['bingo'];

// Caption template for Tumblr posts. {handle} and {name} are replaced at send time.
window.CARD_TUMBLR_CAPTION = "@{handle} here's your bingo card!";

// Post state: 'published' | 'queue' | 'draft'
window.CARD_TUMBLR_POST_STATE = 'published';

// ── Email delivery settings ───────────────────────────────────────────────────

// Display name shown in the From header.
window.CARD_FROM_NAME = 'Bingo Generator';

// Resend sender address. Must be a verified domain in your Resend account.
window.CARD_FROM_EMAIL = 'alecto.perdita@gmail.com';

// Optional Reply-To address. Leave empty to omit the header.
window.CARD_REPLY_TO = '';

// Email subject line. {name} is replaced with the respondent's name.
window.CARD_EMAIL_SUBJECT = "{name}, here's your bingo card!";

// Plain-text email body. {name} is replaced with the respondent's name.
window.CARD_EMAIL_BODY = "Hey {name}, here's your bingo card! It's attached to this email.";
