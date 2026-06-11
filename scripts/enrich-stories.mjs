// AI enrichment: rewrites placeholder summaries/stories on imported places
// using the Claude API. Only touches features whose story mentions "Imported".
//
// Usage:
//   ANTHROPIC_API_KEY=... node scripts/enrich-stories.mjs [path/to/places.json]
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';

const file = process.argv[2] || 'public/data/places.json';
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const band = JSON.parse(await readFile('public/data/band.json', 'utf8'));
const places = JSON.parse(await readFile(file, 'utf8'));
const targets = places.features.filter((f) => /Imported from/i.test(f.properties.story || ''));

if (!targets.length) {
  console.log('Nothing to enrich — no imported placeholder stories found.');
  process.exit(0);
}
console.log(`Enriching ${targets.length} places for ${band.name}…`);

const schema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One punchy line, max 60 characters' },
    story: { type: 'string', description: '2-3 sentences for fans: why this place matters in the band\'s story. Factual; if unsure of details, stay general rather than inventing specifics.' },
  },
  required: ['summary', 'story'],
  additionalProperties: false,
};

for (const feature of targets) {
  const p = feature.properties;
  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 400,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{
      role: 'user',
      content: `Write a map-pin blurb for a ${band.name} fan atlas.\n` +
        `Place: ${p.title}\nCategory: ${p.category}\nYear: ${p.year}\n` +
        `Known context: ${p.summary}\n` +
        'Audience: devoted fans. Tone: warm, knowledgeable, no hype. ' +
        'Do not invent specific facts you are not confident about.',
    }],
  });
  const text = response.content.find((b) => b.type === 'text')?.text;
  try {
    const { summary, story } = JSON.parse(text);
    p.summary = summary;
    p.story = story;
    console.log(`✓ ${p.title}`);
  } catch {
    console.warn(`✗ ${p.title} — could not parse response, left unchanged`);
  }
}

await writeFile(file, JSON.stringify(places, null, 2));
console.log(`Done — updated ${file}`);
