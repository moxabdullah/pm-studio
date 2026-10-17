/* Records the suites need on top of `npm run seed:dev -- --dev-database`, created through the API as the database's superuser
   (call L.suLogin() first). The seed itself is a script, never a copied database. */
import * as L from './browser.mjs';

// the fields of W1 for the field/project suites: the three built-ins, then a number, a date and a dropdown
export const FIELDS = [
  { id: 'client', name: 'Client', type: 'text', inTable: true },
  { id: 'enduser', name: 'End user', type: 'text', inTable: true },
  { id: 'po', name: 'PO / contract no.', type: 'text', inTable: true },
  { id: 'budget1', name: 'Budget', type: 'number', inTable: false },
  { id: 'kick01', name: 'Kickoff', type: 'date', inTable: false },
  {
    id: 'risk01',
    name: 'Risk',
    type: 'select',
    inTable: false,
    options: [
      { id: 'low1', name: 'Low' },
      { id: 'med1', name: 'Medium' },
      { id: 'high1', name: 'High' },
    ],
  },
];

export async function putFields(fields = FIELDS, ws = L.W1) {
  const ex = (await L.lists()).find(r => r.workspace === ws);
  if (ex) return L.api('PATCH', '/collections/workspace_lists/records/' + ex.id, { doc: { ...ex.doc, fields } });
  return L.api('POST', '/collections/workspace_lists/records', { workspace: ws, doc: { fields } });
}

export const projRec = async pid => (await L.api('GET', '/collections/projects/records/' + pid)).body;
export const fvals = async pid => Object.fromEntries(Object.entries((await projRec(pid)).doc).filter(([k]) => k.startsWith('f_')));
export async function patchProject(pid, extra) {
  const r = await projRec(pid);
  await L.api('PATCH', '/collections/projects/records/' + pid, { doc: { ...r.doc, ...extra } });
}
