import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { splitCommission } from '@openrate/shared';
import { ingestConfirmedSale, reverseSale } from '../common/commission-ingest';
import { setupTestDb, teardown, withClaims, claims, hasTestDb, type TestDb } from './setup';

// IDs fixos (determinístico entre execuções).
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '1b1b1b1b-1b1b-1b1b-1b1b-1b1b1b1b1b1b';
const USER_A = '22222222-2222-2222-2222-222222222222';
const STORE_A = '44444444-4444-4444-4444-444444444444';
const PRODUCT_A = '77777777-7777-7777-7777-777777777777';
const PRODUCT_B = '7b7b7b7b-7b7b-7b7b-7b7b-7b7b7b7b7b7b';
const LINK_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RULE_A = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const skip = hasTestDb() ? false : 'defina DATABASE_URL para rodar os testes de integração';
let db: TestDb | null = null;

before(async () => {
  if (!hasTestDb()) return;
  db = await setupTestDb();
  const a = db.admin; // superusuário: semeia sem RLS
  await a.query(`INSERT INTO openrate.organizations (id,name,slug) VALUES ($1,'Rede A','rede-a'),($2,'Rede B','rede-b')`, [ORG_A, ORG_B]);
  await a.query(`INSERT INTO openrate.users (id,organization_id,email,full_name,role,password_hash) VALUES ($1,$2,'ana@a.com','Ana','attendant','x')`, [USER_A, ORG_A]);
  await a.query(`INSERT INTO openrate.stores (id,organization_id,name,slug) VALUES ($1,$2,'Loja A','loja-a')`, [STORE_A, ORG_A]);
  await a.query(`INSERT INTO openrate.products (id,organization_id,scope,name) VALUES ($1,$2,'organization','Produto A')`, [PRODUCT_A, ORG_A]);
  await a.query(`INSERT INTO openrate.products (id,organization_id,scope,name) VALUES ($1,$2,'organization','Produto B')`, [PRODUCT_B, ORG_B]);
  await a.query(
    `INSERT INTO openrate.affiliate_links (id,organization_id,store_id,user_id,product_id,platform,short_code,destination_url,active)
     VALUES ($1,$2,$3,$4,$5,'tiktok','codeA','https://loja/a',true)`,
    [LINK_A, ORG_A, STORE_A, USER_A, PRODUCT_A],
  );
  await a.query(
    `INSERT INTO openrate.commission_rules (id,organization_id,name,creator_pct,store_pct,platform_pct,calc_base,active)
     VALUES ($1,$2,'Regra A',10,5,5,'affiliate_payout',true)`,
    [RULE_A, ORG_A],
  );
});

after(async () => {
  await teardown(db);
});

const linkRef = { id: LINK_A, userId: USER_A, storeId: STORE_A, productId: PRODUCT_A };
const ingestParams = (externalId: string) => ({
  orgId: ORG_A,
  platform: 'tiktok',
  externalId,
  grossAmount: 200,
  commissionableAmount: 20,
  occurredAt: '2026-06-01T10:00:00.000Z',
  link: linkRef,
  categoryId: null as string | null,
});

test('reconciliação: rateio bate com o motor e soma == base × Σpct', { skip }, async () => {
  const res = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    ingestConfirmedSale(c, ingestParams('SALE-1')),
  );
  assert.equal(res.duplicated, false);
  assert.equal(res.ruleId, RULE_A);
  assert.equal(res.entries, 3); // creator + store + platform

  // base = comissionável (20); split 10/5/5 → 2.00 / 1.00 / 1.00
  const expected = splitCommission(20, {
    id: RULE_A, organizationId: ORG_A, storeId: null, productId: null, categoryId: null,
    platform: null, creatorPct: 10, storePct: 5, platformPct: 5,
  });
  assert.deepEqual(res.creatorCredit, { userId: USER_A, amount: expected.creator });

  const rows = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    c
      .query(
        `SELECT beneficiary_type, amount FROM openrate.commission_entries
          WHERE affiliate_sale_id = $1 AND reversal_of IS NULL ORDER BY beneficiary_type`,
        [res.saleId],
      )
      .then((r) => r.rows),
  );
  const byType = Object.fromEntries(rows.map((r) => [r.beneficiary_type, Number(r.amount)]));
  assert.equal(byType.creator, expected.creator);
  assert.equal(byType.store, expected.store);
  assert.equal(byType.platform, expected.platform);
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  assert.equal(Math.round(total * 100) / 100, 4.0); // 20 × 20% = 4.00
});

test('idempotência: reimportar a mesma venda não duplica', { skip }, async () => {
  const first = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    ingestConfirmedSale(c, ingestParams('SALE-DUP')),
  );
  assert.equal(first.duplicated, false);
  assert.ok(first.entries > 0);

  const second = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    ingestConfirmedSale(c, ingestParams('SALE-DUP')),
  );
  assert.equal(second.duplicated, true);
  assert.equal(second.entries, 0);

  const count = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    c
      .query(
        `SELECT count(*)::int AS n FROM openrate.affiliate_sales WHERE platform='tiktok' AND external_id='SALE-DUP'`,
      )
      .then((r) => r.rows[0].n),
  );
  assert.equal(count, 1); // uma única venda persistida
});

test('estorno: espelhos negativos zeram o líquido e cancelam os originais', { skip }, async () => {
  const res = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    ingestConfirmedSale(c, ingestParams('SALE-REV')),
  );
  const reversed = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    reverseSale(c, res.saleId as string, ORG_A),
  );
  assert.equal(reversed, 3);

  const sums = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    c
      .query(
        `SELECT
           COALESCE(SUM(amount),0)::float8 AS net_all,
           COALESCE(SUM(amount) FILTER (WHERE status <> 'cancelled'),0)::float8 AS net_active
         FROM openrate.commission_entries WHERE affiliate_sale_id = $1`,
        [res.saleId],
      )
      .then((r) => r.rows[0]),
  );
  assert.equal(sums.net_all, 0); // original + espelho negativo = 0
  assert.equal(sums.net_active, 0); // nada ativo para pagar após o estorno
});

test('RLS: uma org não enxerga nem altera dados de outra', { skip }, async () => {
  // Org A não vê o produto da Org B; vê o próprio.
  const seenByA = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    c
      .query(`SELECT count(*)::int AS n FROM openrate.products WHERE id = $1`, [PRODUCT_B])
      .then((r) => r.rows[0].n),
  );
  assert.equal(seenByA, 0);

  const ownByA = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    c
      .query(`SELECT count(*)::int AS n FROM openrate.products WHERE id = $1`, [PRODUCT_A])
      .then((r) => r.rows[0].n),
  );
  assert.equal(ownByA, 1);

  // Org A não consegue alterar o produto da Org B (RLS filtra → 0 linhas).
  const affected = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    c
      .query(`UPDATE openrate.products SET name = 'hack' WHERE id = $1`, [PRODUCT_B])
      .then((r) => r.rowCount ?? 0),
  );
  assert.equal(affected, 0);

  // Org A só enxerga a própria organização.
  const orgs = await withClaims(db!.app, claims(USER_A, ORG_A, 'manager'), (c) =>
    c.query(`SELECT count(*)::int AS n FROM openrate.organizations`).then((r) => r.rows[0].n),
  );
  assert.equal(orgs, 1);
});

test('audit_log é append-only para openrate_app (UPDATE bloqueado)', { skip }, async () => {
  await withClaims(db!.app, claims(USER_A, ORG_A, 'owner'), (c) =>
    c.query(
      `INSERT INTO openrate.audit_log (organization_id,user_id,action,entity_type)
       VALUES ($1,$2,'products.create','products')`,
      [ORG_A, USER_A],
    ),
  );
  await assert.rejects(
    withClaims(db!.app, claims(USER_A, ORG_A, 'owner'), (c) =>
      c.query(`UPDATE openrate.audit_log SET action = 'tampered'`),
    ),
    /permission denied|insufficient/i,
  );
});
