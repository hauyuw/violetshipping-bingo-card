// Each question id and option id must be unique and stable — changing them
// after submissions exist will cause orphan picks.
window.SURVEY_QUESTIONS = [
  {
    id: 'q1',
    label: 'Canon Continuity',
    options: [
      { id: 'q1o1',  text: 'AU - Supernatural',         desc: 'Alternate universe featuring magic, demons, vampires, ghosts, or other supernatural elements.' },
      { id: 'q1o2',  text: 'AU - No Millennium Items',  desc: "Alternate universe where the Millennium Items don't exist and the characters are ordinary people." },
      { id: 'q1o3',  text: 'AU - Fantasy',              desc: 'Alternate universe set in a high fantasy world — kingdoms, magic systems, mythical creatures, etc.' },
      { id: 'q1o4',  text: 'AU - Science Fiction',      desc: 'Alternate universe with a futuristic or sci-fi setting — space, cyberpunk, robots, etc.' },
      { id: 'q1o5',  text: 'AU - Historical Period',    desc: 'Alternate universe set in a specific historical era, such as feudal Japan, Victorian England, or ancient Rome.' },
      { id: 'q1o6',  text: 'Crossover/Fusions',         desc: "Crosses over with another fandom, or transplants the characters into another universe's setting." },
      { id: 'q1o7',  text: 'Pre-Canon',                 desc: 'Set before the events of the main series.' },
      { id: 'q1o8',  text: 'Season 0/Early Manga',      desc: 'Based on the early manga or Toei anime (Season 0), before the card game became the main focus.' },
      { id: 'q1o9',  text: 'Duelist Kingdom',           desc: 'Set during or drawing on the Duelist Kingdom arc.' },
      { id: 'q1o10', text: 'Battle City',               desc: 'Set during or drawing on the Battle City tournament arc.' },
      { id: 'q1o11', text: 'Filler Arcs',               desc: 'Set during anime filler arcs not present in the manga, such as DOMA or KC Grand Prix.' },
      { id: 'q1o12', text: 'Memory World',              desc: 'Set during or drawing on the Ancient Egypt / Memory World arc.' },
      { id: 'q1o13', text: 'Post-Canon',                desc: 'Set after the events of the main series.' },
      { id: 'q1o14', text: 'Canon Divergence',          desc: 'Starts from canon but diverges — a "what if" where events unfold differently.' },
    ],
  },
  {
    id: 'q2',
    label: 'Fic Metadata',
    options: [
      { id: 'q2o1',  text: '0 comments',                               desc: 'Be the very first to comment!' },
      { id: 'q2o2',  text: '< 10 comments' },
      { id: 'q2o3',  text: '≤ 1,000 words' },
      { id: 'q2o4',  text: '≤ 5,000 words' },
      { id: 'q2o5',  text: '≤ 10,000 words' },
      { id: 'q2o6',  text: '≥ 10,000 words' },
      { id: 'q2o7',  text: 'Posted/updated within the last month' },
      { id: 'q2o8',  text: 'Posted/updated within the last 6 months' },
      { id: 'q2o9',  text: 'Posted/updated more than a year ago' },
      { id: 'q2o10', text: 'Posted before 2020' },
      { id: 'q2o11', text: 'Posted before 2015' },
      { id: 'q2o12', text: 'Posted before 2010' },
      { id: 'q2o13', text: 'Incomplete/Work-in-Progress',              desc: 'The fic is not yet finished and is still being updated (or was abandoned unfinished).' },
      { id: 'q2o14', text: 'Multichapter fic',                         desc: 'Can be completed or ongoing.' },
      { id: 'q2o15', text: 'Oneshot' },
      { id: 'q2o16', text: 'Not posted on AO3',                        desc: 'Hosted elsewhere — FFNet, Tumblr, Twitter/X, a personal site, or another archive.' },
    ],
  },
  {
    id: 'q3',
    label: 'AO3 Specific',
    options: [
      { id: 'q3o1', text: 'By Anonymous',                           desc: 'The author has chosen to remain anonymous on AO3.' },
      { id: 'q3o2', text: 'Archive-locked fic',                     desc: 'Requires an AO3 account to read.' },
      { id: 'q3o3', text: 'Warning: Major Character Death',         desc: 'The fic carries the Major Character Death warning tag.' },
      { id: 'q3o4', text: 'Warning: Graphic Depiction of Violence', desc: 'The fic carries the Graphic Violence warning tag.' },
      { id: 'q3o5', text: 'Warning: Rape/Non-con',                  desc: 'The fic carries the Rape/Non-Consensual Content warning tag.' },
      { id: 'q3o6', text: 'Warning: Underage Sex',                  desc: 'The fic carries the Underage warning tag.' },
    ],
  },
  {
    id: 'q4',
    label: 'Tropes, Motifs, & Themes',
    options: [
      { id: 'q4o1',  text: 'Dragons' },
      { id: 'q4o2',  text: 'Duel Monsters/Professional dueling', desc: 'Centered around the card game or professional dueling culture.' },
      { id: 'q4o3',  text: 'Fake relationship' },
      { id: 'q4o4',  text: 'Time or dimensional travel',    desc: 'Characters travel through time or cross into alternate dimensions.' },
      { id: 'q4o5',  text: 'Pining',                        desc: "One or both characters has feelings they haven't acted on yet." },
      { id: 'q4o6',  text: 'Omegaverse',                    desc: 'Set in an omegaverse (A/B/O) alternate biology universe.' },
      { id: 'q4o7',  text: 'Soulmates',                     desc: 'Characters are connected by a soulmate bond or have marks that indicate they are soulmates.' },
      { id: 'q4o8',  text: 'Slow burn',                     desc: 'The relationship develops gradually over a long time.' },
      { id: 'q4o9',  text: 'Bodyguard',                     desc: 'One character acts as a bodyguard or protector for the other.' },
      { id: 'q4o10', text: 'Pre-slash',                     desc: 'The story shows the buildup of a relationship without arriving at romance — yet.' },
      { id: 'q4o11', text: 'Getting together',              desc: 'The story centers on the characters becoming a couple.' },
      { id: 'q4o12', text: 'Established relationship',      desc: 'The characters are already in a relationship when the story begins.' },
      { id: 'q4o13', text: 'Going on a date' },
      { id: 'q4o14', text: 'Meeting the family' },
      { id: 'q4o15', text: 'Holidays' },
      { id: 'q4o16', text: 'Birthdays' },
      { id: 'q4o17', text: 'Proposals and weddings' },
      { id: 'q4o18', text: 'Love confession' },
      { id: 'q4o19', text: 'Past lives',                    desc: "Involves the characters' past lives, including their Ancient Egypt counterparts." },
      { id: 'q4o20', text: 'MPreg/raising kids',            desc: 'Features pregnancy, parenting, or raising children together.' },
      { id: 'q4o21', text: 'Break-up/divorce' },
      { id: 'q4o22', text: 'Food',                          desc: 'Cooking, baking, or sharing meals features prominently.' },
      { id: 'q4o23', text: 'LGBTQ+ themes',                 desc: 'Explores queer identity, coming out, or related themes beyond the relationship itself.' },
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
      { id: 'q5o7', text: 'Smut' },
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
