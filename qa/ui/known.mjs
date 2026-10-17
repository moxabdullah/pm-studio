/* Checks that fail because of a real bug on main (not because of the check). They are reported as KNOWN, never counted as passes,
   and do not fail the run. Key: the check id (or "id#2" for a repeated id); value: the reason. When the bug is fixed the check
   passes and the runner says so: delete the entry. */
export const KNOWN = {
  // suite name -> { checkId: reason }
  rt: {
    R2g3: 'Esc on the "Keyboard shortcuts" dialog, opened by Enter in the user menu from the topbar avatar, leaves focus on <body> instead of #top-account (a menu item that opens a modal loses its opener; pre-existing, not fixed). The whole check is KNOWN: when this entry is in place, the dialog opening, the rail tip and the frame count are not being judged, so run the check once without the entry (delete it, run RT_ONLY=R2) when touching that area',
  },
};
