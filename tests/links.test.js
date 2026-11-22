import { describe, it, expect } from 'vitest'
import {
  isCodeId,
  mintPageId,
  pageRefIndex,
  storedPageRef,
  writtenPageRef,
  unresolvedRefs,
  mapSectionRefs,
  withAssetIdentity,
  withoutAssetIdentity,
} from '../src/links.js'

const pages = [
  { id: '3f58142d', route: '/', dynamic: false },
  { id: 'a1b2c3d4', route: '/hours', dynamic: false },
  { id: 'install', route: '/docs/install', dynamic: false },
  { id: null, route: '/about', dynamic: false },
]
const index = pageRefIndex(pages)
const doc = (href) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Go', marks: [{ type: 'link', attrs: { href } }] }] }] })

describe('page links', () => {
  it('tells an editor\'s code from a word', () => {
    expect(isCodeId('3f58142d')).toBe(true)
    expect(isCodeId('home')).toBe(false)
    expect(isCodeId('cafebabe')).toBe(false)
    expect(isCodeId(mintPageId())).toBe(true)
  })

  it('shows a coded link by its page\'s route, the home page as page:/, and a word as written', () => {
    expect(writtenPageRef('page:a1b2c3d4#open', index)).toBe('page:hours#open')
    expect(writtenPageRef('page:3f58142d#bakes', index)).toBe('page:/#bakes')
    expect(writtenPageRef('page:install', index)).toBe('page:install')
    expect(writtenPageRef('https://example.com', index)).toBe('https://example.com')
  })

  it('stores a route as its page\'s code, and leaves a page with no code by its route', () => {
    expect(storedPageRef('page:hours#open', index)).toBe('page:a1b2c3d4#open')
    expect(storedPageRef('page:/#bakes', index)).toBe('page:3f58142d#bakes')
    expect(storedPageRef('page:about', index)).toBe('page:about')
  })

  it('names the links that go nowhere', () => {
    const section = { type: 'Hero', params: { more: 'page:nowhere' }, content: doc('page:home#bakes') }
    expect(unresolvedRefs(section, index)).toEqual(['page:home#bakes', 'page:nowhere'])
    expect(unresolvedRefs({ type: 'Hero', content: doc('page:/') }, index)).toEqual([])
  })

  it('maps a section\'s links without changing the section given', () => {
    const section = { type: 'Hero', content: doc('page:hours') }
    const stored = mapSectionRefs(section, (ref) => storedPageRef(ref, index))
    expect(stored.content.content[0].content[0].marks[0].attrs.href).toBe('page:a1b2c3d4')
    expect(section.content.content[0].content[0].marks[0].attrs.href).toBe('page:hours')
  })
})

describe('withoutAssetIdentity', () => {
  it('leaves an uploaded asset\'s identity out of what an agent reads, and a write gives it back', () => {
    const hash = 'c3ee7f0d40cacb2c7190f04084a9d1e8c2c3518752a8a8b6d82339b494bb3342'
    const d = { type: 'doc', content: [{ type: 'image', attrs: { src: `/static/asset/dist/${hash}/base.webp`, assetId: hash, assetExt: 'webp', alt: 'Counter' } }] }
    withoutAssetIdentity(d)
    expect(d.content[0].attrs).toEqual({ src: `/static/asset/dist/${hash}/base.webp`, alt: 'Counter' })
    withAssetIdentity(d)
    expect(d.content[0].attrs).toMatchObject({ assetId: hash, assetExt: 'webp' })
  })
})

describe('withAssetIdentity', () => {
  const hash = 'c3ee7f0d40cacb2c7190f04084a9d1e8c2c3518752a8a8b6d82339b494bb3342'
  it('gives a picture whose address is an uploaded asset its identity back', () => {
    const d = { type: 'doc', content: [{ type: 'image', attrs: { src: `/static/asset/dist/${hash}/base.webp`, alt: 'Counter' } }] }
    withAssetIdentity(d)
    expect(d.content[0].attrs).toMatchObject({ assetId: hash, assetExt: 'webp', src: `/static/asset/dist/${hash}/base.webp` })
  })

  it('takes a whole address back to the asset\'s path, and leaves any other picture alone', () => {
    const d = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: `http://localhost:8080/static/asset/dist/${hash}/base.webp` } },
        { type: 'image', attrs: { src: 'https://images.example.com/bread.jpg' } },
      ],
    }
    withAssetIdentity(d)
    expect(d.content[0].attrs).toMatchObject({ src: `/static/asset/dist/${hash}/base.webp`, assetId: hash })
    expect(d.content[1].attrs).toEqual({ src: 'https://images.example.com/bread.jpg' })
  })
})
