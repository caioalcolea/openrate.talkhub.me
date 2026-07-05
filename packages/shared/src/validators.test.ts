import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidCpf, isValidCnpj, isValidCpfCnpj, isValidCep, isValidPhoneBR } from './validators';

test('isValidCpf: aceita válido e rejeita inválido/sequência', () => {
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('52998224725'), true);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('529.982.247-24'), false);
  assert.equal(isValidCpf('123'), false);
});

test('isValidCnpj: aceita válido e rejeita inválido/sequência', () => {
  assert.equal(isValidCnpj('11.222.333/0001-81'), true);
  assert.equal(isValidCnpj('11222333000181'), true);
  assert.equal(isValidCnpj('00.000.000/0000-00'), false);
  assert.equal(isValidCnpj('11.222.333/0001-80'), false);
});

test('isValidCpfCnpj: escolhe pelo tamanho', () => {
  assert.equal(isValidCpfCnpj('52998224725'), true);
  assert.equal(isValidCpfCnpj('11222333000181'), true);
  assert.equal(isValidCpfCnpj('123456'), false);
});

test('isValidCep e isValidPhoneBR', () => {
  assert.equal(isValidCep('01310-100'), true);
  assert.equal(isValidCep('01310100'), true);
  assert.equal(isValidCep('123'), false);
  assert.equal(isValidPhoneBR('(11) 98888-7777'), true);
  assert.equal(isValidPhoneBR('1133334444'), true);
  assert.equal(isValidPhoneBR('999'), false);
});
