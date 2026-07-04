import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRule, splitCommission, rulePriority, type CommissionRule } from './commission';

const base = (over: Partial<CommissionRule>): CommissionRule => ({
  id: 'r',
  organizationId: 'org-1',
  storeId: null,
  productId: null,
  categoryId: null,
  platform: null,
  creatorPct: 10,
  storePct: 10,
  platformPct: 5,
  ...over,
});

test('mais específica vence: produto > loja > org', () => {
  const rules = [
    base({ id: 'org', creatorPct: 5 }),
    base({ id: 'store', storeId: 's1', creatorPct: 8 }),
    base({ id: 'prod', storeId: 's1', productId: 'p1', creatorPct: 12 }),
  ];
  const r = resolveRule(rules, {
    organizationId: 'org-1',
    storeId: 's1',
    productId: 'p1',
    categoryId: null,
    platform: null,
  });
  assert.equal(r?.id, 'prod');
});

test('rulePriority soma os pesos de especificidade', () => {
  assert.ok(
    rulePriority(base({ productId: 'p', storeId: 's' })) >
      rulePriority(base({ storeId: 's' })),
  );
});

test('splitCommission: soma bate e platform absorve o resíduo', () => {
  const s = splitCommission(100, base({ creatorPct: 33.33, storePct: 33.33, platformPct: 33.34 }));
  assert.equal(s.creator + s.store + s.platform, 100);
});

test('splitCommission arredonda a 2 casas', () => {
  const s = splitCommission(99.99, base({ creatorPct: 10, storePct: 5, platformPct: 5 }));
  assert.equal(Math.round(s.creator * 100) / 100, s.creator);
});

test('splitCommission nunca super-credita nem gera parcela negativa (centavo ímpar 50/50)', () => {
  const s = splitCommission(0.03, base({ creatorPct: 50, storePct: 50, platformPct: 0 }));
  assert.equal(s.creator + s.store + s.platform, 0.03);
  assert.ok(s.creator >= 0 && s.store >= 0 && s.platform >= 0);
});

test('rulePriority: regra com platform vence regra sem platform (mesma especificidade)', () => {
  const comOrg = base({ organizationId: 'o' });
  const comOrgPlat = base({ organizationId: 'o', platform: 'tiktok' });
  assert.ok(rulePriority(comOrgPlat) > rulePriority(comOrg));
});

test('resolveRule aplica a dimensão de plataforma no desempate', () => {
  const rules = [
    base({ id: 'org', organizationId: 'org-1' }),
    base({ id: 'org-tt', organizationId: 'org-1', platform: 'tiktok' }),
  ];
  const r = resolveRule(rules, {
    organizationId: 'org-1', storeId: null, productId: null, categoryId: null, platform: 'tiktok',
  });
  assert.equal(r?.id, 'org-tt');
});
