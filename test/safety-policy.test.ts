import { doesNotThrow, equal, throws } from 'node:assert/strict'
import { test } from 'node:test'
import {
  CUSTOM_PROVIDER_EXECUTION_ENV,
  assertProviderEntryIntegrity,
  extractSkillToken,
  isAllowedSkillHost,
  isCustomProviderExecutionAllowed,
  resolveProviderEntryUrl,
  sha256
} from '../src/main/security-policy'

test('skill server accepts only loopback hosts', (): void => {
  equal(isAllowedSkillHost('127.0.0.1:12680'), true)
  equal(isAllowedSkillHost('localhost:12680'), true)
  equal(isAllowedSkillHost('[::1]:12680'), true)
  equal(isAllowedSkillHost('0.0.0.0:12680'), false)
  equal(isAllowedSkillHost('example.com'), false)
  equal(isAllowedSkillHost(undefined), false)
})

test('skill server extracts explicit token header before bearer auth', (): void => {
  equal(
    extractSkillToken({
      'x-sightflow-token': ' local-token ',
      authorization: 'Bearer bearer-token'
    }),
    'local-token'
  )
  equal(extractSkillToken({ authorization: 'Bearer bearer-token' }), 'bearer-token')
  equal(extractSkillToken({ authorization: 'Basic ignored' }), '')
})

test('custom provider execution is disabled unless explicitly enabled', (): void => {
  equal(isCustomProviderExecutionAllowed({}), false)
  equal(isCustomProviderExecutionAllowed({ [CUSTOM_PROVIDER_EXECUTION_ENV]: '0' }), false)
  equal(isCustomProviderExecutionAllowed({ [CUSTOM_PROVIDER_EXECUTION_ENV]: '1' }), true)
})

test('provider entry integrity blocks missing or changed bundles', (): void => {
  const entryContent = 'export const ok = true'
  doesNotThrow(() =>
    assertProviderEntryIntegrity({ entrySha256: sha256(entryContent) }, entryContent)
  )
  throws(() => assertProviderEntryIntegrity({}, entryContent), /缺少入口文件摘要/)
  throws(
    () => assertProviderEntryIntegrity({ entrySha256: sha256(entryContent) }, `${entryContent}!`),
    /摘要不匹配/
  )
})

test('provider entry URL must keep the manifest protocol boundary', (): void => {
  equal(
    resolveProviderEntryUrl('https://providers.example.com/acme/manifest.json', './entry.js'),
    'https://providers.example.com/acme/entry.js'
  )
  equal(
    resolveProviderEntryUrl('file:///tmp/sightflow-provider/manifest.json', './entry.js'),
    'file:///tmp/sightflow-provider/entry.js'
  )
  throws(
    () =>
      resolveProviderEntryUrl(
        'https://providers.example.com/acme/manifest.json',
        'file:///tmp/evil.js'
      ),
    /必须使用相同协议/
  )
  throws(
    () =>
      resolveProviderEntryUrl(
        'file:///tmp/sightflow-provider/manifest.json',
        'https://example.com/entry.js'
      ),
    /必须使用相同协议/
  )
})
