// Replace these placeholder questions and options with your own content.
// Each question id and option id must be unique and stable — changing them
// after submissions exist will cause orphan picks.
window.SURVEY_QUESTIONS = [
  {
    id: 'q1',
    label: 'Favourite season',
    options: [
      { id: 'q1o1', text: 'Spring' },
      { id: 'q1o2', text: 'Summer' },
      { id: 'q1o3', text: 'Autumn' },
      { id: 'q1o4', text: 'Winter' },
    ],
  },
  {
    id: 'q2',
    label: 'Preferred music genre',
    options: [
      { id: 'q2o1', text: 'Pop' },
      { id: 'q2o2', text: 'Rock' },
      { id: 'q2o3', text: 'Jazz' },
      { id: 'q2o4', text: 'Classical' },
      { id: 'q2o5', text: 'Electronic' },
      { id: 'q2o6', text: 'Hip-hop' },
    ],
  },
  {
    id: 'q3',
    label: 'Go-to comfort food',
    options: [
      { id: 'q3o1', text: 'Pizza' },
      { id: 'q3o2', text: 'Ramen' },
      { id: 'q3o3', text: 'Tacos' },
      { id: 'q3o4', text: 'Pasta' },
      { id: 'q3o5', text: 'Soup' },
      { id: 'q3o6', text: 'Salad' },
      { id: 'q3o7', text: 'Sushi' },
    ],
  },
  {
    id: 'q4',
    label: 'Hobby you enjoy',
    options: [
      { id: 'q4o1', text: 'Reading' },
      { id: 'q4o2', text: 'Gaming' },
      { id: 'q4o3', text: 'Drawing' },
      { id: 'q4o4', text: 'Cooking' },
      { id: 'q4o5', text: 'Hiking' },
      { id: 'q4o6', text: 'Photography' },
      { id: 'q4o7', text: 'Knitting' },
      { id: 'q4o8', text: 'Writing' },
    ],
  },
  {
    id: 'q5',
    label: 'Night owl or early bird?',
    options: [
      { id: 'q5o1', text: 'Definitely night owl' },
      { id: 'q5o2', text: 'Leaning night owl' },
      { id: 'q5o3', text: 'Somewhere in between' },
      { id: 'q5o4', text: 'Leaning early bird' },
      { id: 'q5o5', text: 'Definitely early bird' },
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
window.CARD_FROM_EMAIL = 'you@example.com';

// Optional Reply-To address. Leave empty to omit the header.
window.CARD_REPLY_TO = '';

// Email subject line. {name} is replaced with the respondent's name.
window.CARD_EMAIL_SUBJECT = "{name}, here's your bingo card!";

// Plain-text email body. {name} is replaced with the respondent's name.
window.CARD_EMAIL_BODY = "Hey {name}, here's your bingo card! It's attached to this email.";
