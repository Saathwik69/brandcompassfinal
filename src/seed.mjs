export const demoDraft = {
  title: 'A better everyday bottle',
  channel: 'Instagram',
  audience: 'Everyday explorers',
  text: "Introducing the revolutionary Verdant Bottle! The world's best bottle keeps drinks cold for 48 hours. This cheap upgrade costs INR 699. HURRY, SHOP NOW!!!",
  alt: '',
  foreground: '#9CA3AF',
  background: '#FFFFFF',
  largeText: false,
  image: null,
  campaign: 'Everyday, better'
};

export function seedState() {
  const stamp = new Date().toISOString();
  const rule = (id, title, type, body, config, severity = 'medium') => ({
    id,
    title,
    type,
    body,
    config,
    severity,
    version: 1,
    source: 'Verdant Brand Handbook',
    updated_at: stamp,
    active: true
  });
  return {
    schema: 2,
    knowledge_version: 1,
    brand: {
      name: 'Verdant',
      tagline: 'Everyday, better.',
      description: 'A fictional reusable drinkware brand. All demo facts are synthetic.',
      palette: ['#0F766E', '#172B26', '#F4F7F5', '#FFFFFF', '#D7F47B']
    },
    rules: [
      rule(
        'terms',
        'Words that feel like us',
        'term',
        'Use clear, considered language. Replace cheap with affordable; revolutionary with thoughtfully designed.',
        {
          terms: [
            { term: 'cheap', replacement: 'affordable' },
            { term: 'revolutionary', replacement: 'thoughtfully designed' }
          ]
        }
      ),
      rule(
        'claims',
        'Back every product claim',
        'claims',
        'Numerical claims, certifications, superlatives and guarantees need a current approved fact. Unmatched claims must be marked cannot verify.',
        {},
        'high'
      ),
      rule(
        'voice',
        'Calm confidence',
        'tone',
        'Our voice is calm, welcoming and useful. Avoid HURRY, excessive exclamation marks and shouting.',
        { phrases: ['hurry', 'buy now or regret it'] }
      ),
      rule(
        'alt',
        'Describe informative images',
        'alt',
        'Informative images need meaningful alt text. Decorative images should be explicitly marked decorative.',
        {},
        'high'
      ),
      rule(
        'contrast',
        'Make every word readable',
        'contrast',
        'Use a minimum contrast ratio of 4.5:1 for normal text and 3:1 for large text. Large means at least 24 CSS px, or 18.67 CSS px bold.',
        {},
        'high'
      ),
      rule(
        'palette',
        'Use the approved palette',
        'palette',
        'Use approved brand colours in designed graphics. Photo colours are not a brand-palette violation.',
        { tolerance: 50 }
      ),
      rule(
        'assets',
        'Use approved visual assets',
        'asset',
        'A logo or controlled brand asset must match an approved file and preserve aspect ratio and brand colours.',
        {},
        'high'
      ),
      rule(
        'readability',
        'Keep sentences manageable',
        'readability',
        'Aim for sentences of no more than 26 words. This is a writing heuristic, not a readability certification.',
        { maxWords: 26 },
        'low'
      ),
      rule(
        'offers',
        'Explain offer conditions',
        'disclaimer',
        'Discount promotions must include Terms apply. and link to conditions before publication.',
        { text: 'Terms apply.' },
        'medium'
      )
    ],
    facts: [
      {
        id: 'fact-capacity',
        title: 'Bottle capacity',
        text: 'Verdant Bottle holds 750 ml.',
        source: 'Product Fact Sheet / Capacity',
        version: 1,
        valid_until: '2027-12-31',
        active: true
      },
      {
        id: 'fact-price',
        title: 'Retail price',
        text: 'Verdant Bottle costs INR 999.',
        source: 'Product Fact Sheet / India pricing',
        version: 1,
        valid_until: '2027-12-31',
        active: true
      },
      {
        id: 'fact-cold',
        title: 'Cold retention',
        text: 'Verdant Bottle keeps drinks cold for 12 hours.',
        source: 'Product Fact Sheet / Thermal test',
        version: 1,
        valid_until: '2027-12-31',
        active: true
      },
      {
        id: 'fact-delivery',
        title: 'Standard delivery',
        text: 'Standard delivery takes 3 to 5 business days.',
        source: 'Shipping Policy / Standard delivery',
        version: 1,
        valid_until: '2027-12-31',
        active: true
      }
    ],
    assets: [],
    reviews: [],
    gdocs: [
      {
        doc_id: 'gdoc-verdant-launch-brief',
        doc_title: 'Verdant Summer Launch Copy (Google Doc)',
        doc_url: 'https://docs.google.com/document/d/gdoc-verdant-launch-brief/edit',
        doc_revision_id: 'rev-1',
        channel: 'Website',
        text: "Introducing the revolutionary Verdant Bottle! The Verdant Bottle has a capacity of 750 millilitres and retails for ₹999. Our bottle lasts twice as long. HURRY, SHOP NOW!!!",
        updated_at: stamp
      }
    ],
    invitations: [],
    published_items: [],
    retention: {
      max_drafts: 120,
      max_revisions: 25,
      demo_ttl_hours: 24
    },
    audit: [],
    created_at: stamp
  };
}
