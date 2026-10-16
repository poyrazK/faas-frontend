import { describe, expect, it } from 'vitest';
import { reviewHostingRelease, hostingReviewIsCurrent } from './hosting-review';
import type { HostingFile, HostingRelease, HostingSite } from './hosting';

const site: HostingSite = { id:'site', account_id:'account', project_id:'project', environment:'production', name:'web', hostname:'site.hosting.example', status:'active', revision:9, active_release_id:'old', durable_routing:true, suspended:false, created_at:'2026-10-16T19:20:00Z' };
const file = (path:string, size:number): HostingFile => ({ path, size, sha256:'a'.repeat(64), content_type:'text/html' });
const old: HostingRelease = { id:'old', site_id:site.id, state:'ready', created_at:site.created_at, manifest:{spa_fallback:false,files:[file('index.html',3),file('removed.html',4),file('mime.html',5)]} };
const next: HostingRelease = { id:'new', site_id:site.id, state:'ready', created_at:site.created_at, manifest:{spa_fallback:true,config:{version:1,redirects:[{from:'/old',to:'/new',status:308}],headers:[{path:'/*',values:{'permissions-policy':'camera=()'}}],not_found:'index.html'},files:[file('new.html',7),file('index.html',8),{...file('mime.html',5),content_type:'text/plain'}]} };

describe('reviewed hosting releases', () => {
  it('compares bytes, content types, and complete release settings with stable path ordering', () => {
    const r=reviewHostingRelease(site,[old,next],'new');
    expect(r).toMatchObject({site_id:'site',expected_revision:9,base_release_id:'old',release_id:'new',added:1,changed:2,removed:1,before_bytes:12,after_bytes:20,settings_changed:true});
    expect(r.files.map(f => [f.path,f.change])).toEqual([['index.html','changed'],['mime.html','changed'],['new.html','added'],['removed.html','removed']]);
    expect(r.after_settings.config).toEqual(next.manifest.config);
  });
  it('preserves the reviewed values if later polling replaces or changes data', () => {
    const target=structuredClone(next);const r=reviewHostingRelease(site,[old,target],'new');
    target.manifest.files[0].size=100;target.manifest.config!.redirects![0].to='/else';
    expect(r.after_bytes).toBe(20);expect(r.after_settings.config!.redirects![0].to).toBe('/new');
    expect(hostingReviewIsCurrent(r,{...site,revision:10},[old,target])).toBe(false);
    expect(hostingReviewIsCurrent(r,{...site,active_release_id:'other'},[old,target])).toBe(false);
    expect(hostingReviewIsCurrent(r,site,[old,{...next,state:'retiring'}])).toBe(false);
    expect(hostingReviewIsCurrent(r,site,[old,next])).toBe(true);
  });
  it('never invents an empty baseline when an active release is absent', () => {
    expect(() => reviewHostingRelease(site,[next],'new')).toThrow('Refresh');
    const first=reviewHostingRelease({...site,active_release_id:''},[next],'new');
    expect(first.added).toBe(3);expect(first.before_bytes).toBe(0);
  });
  it('rejects pending, retiring, duplicate and foreign targets', () => {
    for (const target of [{...next,state:'pending' as const},{...next,state:'retiring' as const},{...next,site_id:'foreign'}]) expect(() => reviewHostingRelease(site,[old,target],'new')).toThrow();
    expect(() => reviewHostingRelease(site,[old,next,next],'new')).toThrow();
  });
  it('ignores object key ordering but preserves header rule ordering', () => {
    const a=structuredClone(next);a.id='old';const b=structuredClone(next);
    a.manifest.config!.headers=[{path:'/*',values:{'permissions-policy':'camera=()','x-frame-options':'DENY'}}];
    b.manifest.config!.headers=[{path:'/*',values:{'x-frame-options':'DENY','permissions-policy':'camera=()'}}];
    expect(reviewHostingRelease(site,[a,b],'new').settings_changed).toBe(false);
    b.manifest.config!.headers.push({path:'/docs/*',values:{'x-frame-options':'SAMEORIGIN'}});
    expect(reviewHostingRelease(site,[a,b],'new').settings_changed).toBe(true);
  });
});
