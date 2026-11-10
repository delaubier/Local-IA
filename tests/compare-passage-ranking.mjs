import { build } from 'esbuild'
import { pipeline, env } from '@huggingface/transformers'

const bundle = await build({ entryPoints: ['src/utils/webEvidence.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { buildWebEvidence } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))
env.cacheDir = '.local/embedding-cache'
const embed = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { device: 'cpu', dtype: 'q8' })

// The first passage is the reference answer. The other passages contain plausible distractions.
const cases = [
  ['Comment diminuer le bruit dans une pièce au sol dur ?', [
    'Un tapis épais et des rideaux lourds absorbent une partie de la réverbération dans un salon carrelé.',
    'Le bruit des travaux d’une pièce dépend de la dureté du sol et du type de chantier.',
    'La dureté des sols varie selon la composition de la dalle et la densité du support.',
  ]],
  ['Quand le satellite Merle a-t-il décollé ?', [
    'The Merle spacecraft lifted off on April 19, 2023, from the launch site in Kourou.',
    'Le satellite Merle doit décoller le 17 avril 2023 si la météo permet le lancement.',
    'Le satellite Aigle a décollé avec succès le 19 mars 2023 depuis le même site.',
  ]],
  ['Quelle est la hauteur de la tour de Brume avec son antenne ?', [
    'La tour de Brume mesure 142 mètres avec son antenne, qui représente les 8 derniers mètres.',
    'La tour de Brume mesure 134 mètres sans antenne selon le plan du bâtiment.',
    'La tour de Brune avec son antenne atteint une hauteur de 145 mètres selon la mairie.',
  ]],
  ['Quel effet a eu la suppression des frais de dossier sur les inscriptions ?', [
    'Les adhésions ont augmenté de 18 % après l’abandon du paiement administratif.',
    'Les frais de dossier et les inscriptions sont gérés par deux services administratifs distincts.',
    'La suppression des frais de port a accéléré les livraisons sans modifier les achats.',
  ]],
  ['How can a tenant end their lease early?', [
    'A renter can move out before the contract expires by agreeing a surrender in writing with the landlord.',
    'Tenant insurance can end early if the tenant files a claim and submits supporting documents.',
    'The landlord can end the lease early after a court order for a material breach.',
  ]],
  ['Le médicament X17 contient-il du lactose ?', [
    'La liste des excipients du médicament X17 ne contient pas de lactose : amidon, cellulose et stéarate.',
    'Le médicament X71 contient du lactose et ne doit pas être confondu avec un autre dosage.',
    'Le lactose est un sucre du lait utilisé dans la fabrication de certains comprimés.',
  ]],
]

const totals = { lexical: 0, semantic: 0, hybrid: 0 }
let totalMs = 0
try {
  for (const [query, passages] of cases) {
    const sources = passages.map((text, index) => ({ url: `https://source${index}.example/`, title: '', domain: `source${index}.example`, snippet: '', fullText: text }))
    const lexical = buildWebEvidence(query, sources).sources.map(source => sources.findIndex(candidate => candidate.url === source.url))
    const begin = performance.now()
    const vectors = await embed([`query: ${query}`, ...passages.map(text => `passage: ${text}`)], { pooling: 'mean', normalize: true })
    totalMs += performance.now() - begin
    const [queryVector, ...passageVectors] = vectors.tolist()
    const semantic = passageVectors.map((vector, index) => ({
      index, similarity: vector.reduce((sum, value, i) => sum + value * queryVector[i], 0),
    })).sort((a, b) => b.similarity - a.similarity).map(({ index }) => index)
    const reciprocal = (rank, index) => rank.includes(index) ? 1 / (2 + rank.indexOf(index)) : 0
    const hybrid = [...semantic].sort((a, b) => (
      reciprocal(lexical, b) + reciprocal(semantic, b) - reciprocal(lexical, a) - reciprocal(semantic, a)
    ))
    const choices = { lexical: lexical[0], semantic: semantic[0], hybrid: hybrid[0] }
    for (const name of Object.keys(choices)) totals[name] += Number(choices[name] === 0)
    console.log(query, choices)
  }
  console.log('Premier passage correct sur', cases.length, totals)
  console.log('Temps moyen d’encodage à chaud :', Math.round(totalMs / cases.length), 'ms pour 1 question et 3 passages')
} finally { await embed.dispose() }
