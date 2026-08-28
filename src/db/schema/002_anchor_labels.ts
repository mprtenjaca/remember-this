// 002 — rewrite anchor labels that used the old Croatian possessive.
//
// The app used to build "Anin rođendan" / "Martiov rođendan" by approximating the possessive. That produced
// wrong forms for most names (Marti → "Martiov", Luka → "Lukin"), so labels are now "Rođendan · <Ime>"
// (see src/domain/enrich/labels.ts). Rows already in the DB keep the old text until it is rewritten here.
//
// Append-only: this migration only touches rows whose label still ends in the old pattern, and never the
// pseudo-person "Brak" (its label is "Godišnjica braka", which was always correct).

export const SQL_002 = `
UPDATE anchors
   SET label = 'Rođendan · ' || person,
       updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE person IS NOT NULL
   AND person <> 'Brak'
   AND kind = 'birthday'
   AND label LIKE '%rođendan%'
   AND label <> ('Rođendan · ' || person);

UPDATE anchors
   SET label = 'Godišnjica · ' || person,
       updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
 WHERE person IS NOT NULL
   AND person <> 'Brak'
   AND kind = 'anniversary'
   AND label LIKE '%godišnjic%'
   AND label <> ('Godišnjica · ' || person);
`;
