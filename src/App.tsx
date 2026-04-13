import { useState, useMemo, useEffect } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

import { COLORS, LISTING_MAP, SITE_MAP, USER_MAP, REFERRAL_MAP, USED_FIELDS, FIELD_DEFS } from './constants';
import { percentage, formatNumber, parseFile, exportToExcel, exportToCSVStream, sortIcon, sortHeaderStyle, deltaColor } from './utils';
import { MiniBar, Bar, Donut, Area, Funnel, Geo, KPI, Upload } from './components/charts';
import { useListingStats } from './hooks/useListingStats';
import { useSiteStats } from './hooks/useSiteStats';
import { useUserStats } from './hooks/useUserStats';
import { useSiteMaturity } from './hooks/useSiteMaturity';
import { useStaffing } from './hooks/useStaffing';
import { useDataQuality } from './hooks/useDataQuality';
import { useReferralAnalytics } from './hooks/useReferralAnalytics';
import { useFileParser, type IngestRoute } from './hooks/useFileParser';
import type { HeaderDiag } from './types';

export default function App() {
  const [listings,setListings]=useState<Record<string,string>[]|null>(null);
  const [sites,setSites]=useState<Record<string,string>[]|null>(null);
  const [users,setUsers]=useState<Record<string,string>[]|null>(null);
  const [referralsLoaded,setReferralsLoaded]=useState(false);
  const [parseErrors,setParseErrors]=useState<Record<string,string>>({});
  const [listingHeaders,setListingHeaders]=useState<HeaderDiag[]>([]);
  const [siteHeaders,setSiteHeaders]=useState<HeaderDiag[]>([]);
  const [userHeaders,setUserHeaders]=useState<HeaderDiag[]>([]);
  const [referralHeaders,setReferralHeaders]=useState<HeaderDiag[]>([]);
  const [geoGroupField,setGeoGroupField]=useState<string>('province');
  const [tab,setTab]=useState('overview');
  const [siteSearchQuery,setSiteSearchQuery]=useState('');
  const [siteSortField,setSiteSortField]=useState('total');
  const [siteSortDir,setSiteSortDir]=useState<'asc'|'desc'>('desc');
  const [staffSearchQuery,setStaffSearchQuery]=useState('');
  const [staffSortField,setStaffSortField]=useState('absDelta');
  const [staffSortDir,setStaffSortDir]=useState<'asc'|'desc'>('desc');
  const [expandedSite,setExpandedSite]=useState<string|null>(null);
  const [includeTest,setIncludeTest]=useState(true);
  const [selectedRegion,setSelectedRegion]=useState<string>('__all__');
  const [referralSection,setReferralSection]=useState<'target'|'source'|'sender'>('target');
  const [referralSearchQuery,setReferralSearchQuery]=useState('');
  const [referralSortField,setReferralSortField]=useState('totalRefs');
  const [referralSortDir,setReferralSortDir]=useState<'asc'|'desc'>('desc');
  const [referralExpanded,setReferralExpanded]=useState<string|null>(null);
  const referralParser = useFileParser();
  const chooseIngestRoute = (): IngestRoute => {
    const v = window.prompt('Choose parser path for this upload:\n- auto (recommended)\n- small\n- large', 'auto');
    if (v === 'small' || v === 'large') return v;
    return 'auto';
  };

  useEffect(() => {
    if (!referralParser.error) return;
    setParseErrors(p => ({ ...p, referrals: referralParser.error || 'Unable to parse Referral Analytics file.' }));
  }, [referralParser.error]);

  useEffect(() => {
    if (!referralParser.metadata) return;
    setParseErrors(p => ({ ...p, referrals: '' }));
    setReferralsLoaded(true);
    setReferralHeaders(referralParser.headerDiag || []);
  }, [referralParser.metadata, referralParser.headerDiag]);

  const allLoaded=listings&&sites&&users;
  const anyLoaded=listings||sites||users||referralsLoaded;
  const testCount=useMemo(()=>listings?listings.filter(l=>l.testMode==='TRUE').length:0,[listings]);
  const uniqueRegions=useMemo(()=>{
    if(!listings) return [];
    return [...new Set(listings.map(l=>l.healthRegion||'').filter(Boolean))].sort();
  },[listings]);
  const filteredListings=useMemo(()=>{
    if(!listings) return null;
    let result=includeTest?listings:listings.filter(l=>l.testMode!=='TRUE');
    if(selectedRegion!=='__all__') result=result.filter(l=>l.healthRegion===selectedRegion);
    return result;
  },[listings,includeTest,selectedRegion]);

  const listingStats = useListingStats(filteredListings, geoGroupField);
  const siteStats = useSiteStats(sites);
  const userStats = useUserStats(users);
  const siteMaturity = useSiteMaturity(filteredListings, sites, userStats);
  const staffing = useStaffing(filteredListings, sites, userStats);
  const dataQuality = useDataQuality(filteredListings, sites, users);

  const filteredStaff=useMemo(()=>{
    if(!staffing) return null;
    let r=staffing;
    if(staffSearchQuery.trim()){const q=staffSearchQuery.toLowerCase();r=r.filter(s=>(s.siteName||'').toLowerCase().includes(q)||(s.siteNum||'').toLowerCase().includes(q));}
    return [...r].sort((a,b)=>{let av:any,bv:any;
      if(staffSortField==='siteName'){av=(a.siteName||'').toLowerCase();bv=(b.siteName||'').toLowerCase();}
      else if(staffSortField==='siteNum'){av=parseInt(a.siteNum)||0;bv=parseInt(b.siteNum)||0;}
      else{av=(a as any)[staffSortField]??0;bv=(b as any)[staffSortField]??0;}
      return av<bv?(staffSortDir==='asc'?-1:1):av>bv?(staffSortDir==='asc'?1:-1):0;
    });
  },[staffing,staffSearchQuery,staffSortField,staffSortDir]);

  const regionListingRefs=useMemo(()=>{
    if(selectedRegion==='__all__'||!listings) return null;
    return new Set(listings.filter(l=>l.healthRegion===selectedRegion).map(l=>l.ref).filter(Boolean));
  },[listings,selectedRegion]);
  useEffect(() => {
    const storageKey = referralParser.metadata?.storageKey;
    if (!storageKey) return;
    if (includeTest && !regionListingRefs) return;
    referralParser.recomputeFromStore(
      storageKey,
      includeTest,
      regionListingRefs ? [...regionListingRefs] : [],
      { sites, listings, users },
    );
  }, [referralParser.metadata?.storageKey, referralParser.recomputeFromStore, includeTest, regionListingRefs, sites, listings, users]);
  const referralAnalytics = useReferralAnalytics(null, null, sites, listings, users, referralParser.analytics);
  const referralIngestDiag = referralParser.metadata?.diagnostics;
  const referralIngestAcceptance = referralIngestDiag ? percentage(referralIngestDiag.acceptedRows, Math.max(referralIngestDiag.sourceRows, 1)) : 0;
  const referralIngestStatus = referralIngestDiag
    ? referralIngestAcceptance >= 99.9 ? { label: 'Healthy', color: COLORS.green }
      : referralIngestAcceptance >= 99 ? { label: 'Watch', color: COLORS.amber }
        : { label: 'Critical', color: COLORS.red }
    : null;

  const filteredReferralData=useMemo(()=>{
    if(!referralAnalytics) return null;
    const list=referralSection==='target'?referralAnalytics.byTarget:referralSection==='source'?referralAnalytics.bySource:referralAnalytics.bySender;
    const pinned=list.filter((s:any)=>s.isUnknown);
    let r=list.filter((s:any)=>!s.isUnknown) as any[];
    if(referralSearchQuery.trim()){const q=referralSearchQuery.toLowerCase();r=r.filter((s:any)=>Object.values(s).some(v=>typeof v==='string'&&v.toLowerCase().includes(q)));}
    r.sort((a:any,b:any)=>{let av=a[referralSortField]??0,bv=b[referralSortField]??0;if(typeof av==='string'){av=av.toLowerCase();bv=(bv as string).toLowerCase();}return av<bv?(referralSortDir==='asc'?-1:1):av>bv?(referralSortDir==='asc'?1:-1):0;});
    return [...pinned,...r];
  },[referralAnalytics,referralSection,referralSearchQuery,referralSortField,referralSortDir]);

  const doRtSort=(f:string)=>{if(referralSortField===f)setReferralSortDir(d=>d==='asc'?'desc':'asc');else{setReferralSortField(f);setReferralSortDir('desc');}};

  const filteredSiteMaturity=useMemo(()=>{
    if(!siteMaturity) return null;
    let r=siteMaturity;
    if(siteSearchQuery.trim()){const q=siteSearchQuery.toLowerCase();r=r.filter(s=>(s.siteName||'').toLowerCase().includes(q)||(s.siteNum||'').toLowerCase().includes(q)||(s.emr||'').toLowerCase().includes(q));}
    return [...r].sort((a,b)=>{let av:any,bv:any;
      if(siteSortField==='siteName'){av=(a.siteName||'').toLowerCase();bv=(b.siteName||'').toLowerCase();}
      else if(siteSortField==='emr'){av=(a.emr||'').toLowerCase();bv=(b.emr||'').toLowerCase();}
      else if(siteSortField==='siteNum'){av=parseInt(a.siteNum)||0;bv=parseInt(b.siteNum)||0;}
      else if(siteSortField==='validated'){av=+!!a.validated;bv=+!!b.validated;}
      else{av=(a as any)[siteSortField]||0;bv=(b as any)[siteSortField]||0;}
      return av<bv?(siteSortDir==='asc'?-1:1):av>bv?(siteSortDir==='asc'?1:-1):0;
    });
  },[siteMaturity,siteSearchQuery,siteSortField,siteSortDir]);

  const doSort=(f:string)=>{if(siteSortField===f)setSiteSortDir(d=>d==='asc'?'desc':'asc');else{setSiteSortField(f);setSiteSortDir('desc');}};
  const doStSort=(f:string)=>{if(staffSortField===f)setStaffSortDir(d=>d==='asc'?'desc':'asc');else{setStaffSortField(f);setStaffSortDir('desc');}};

  return <div style={{minHeight:'100vh',background:COLORS.background,color:COLORS.text,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
    <div style={{background:'linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)',borderBottom:'1px solid '+COLORS.border,padding:'20px 32px'}}>
      <div style={{maxWidth:1400,margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:36,height:36,borderRadius:8,background:'linear-gradient(135deg,'+COLORS.accent+','+COLORS.purple+')',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:800,color:'#fff'}}>O</div>
            <h1 style={{fontSize:22,fontWeight:800,letterSpacing:-0.5,margin:0}}>Ocean eReferral Adoption Dashboard</h1>
          </div>
          <p style={{fontSize:13,color:COLORS.dimmed,marginTop:4,marginLeft:48,marginBottom:0}}>Regional Authority — Onboarding & Adoption Analytics</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {([['Listings',listings?listings.length:null],['Sites',sites?sites.length:null],['Users',users?users.length:null],['Referrals',referralParser.metadata?.rowCount??(referralsLoaded?0:null)]] as [string,number|null][]).map(([l,d])=><span key={l} style={{fontSize:12,padding:'4px 10px',borderRadius:6,background:d!==null?COLORS.greenDark:'transparent',color:d!==null?COLORS.green:COLORS.dimmed,border:'1px solid '+(d!==null?COLORS.green+'66':COLORS.border),fontWeight:600}}>{l} {d!==null?d:'—'}</span>)}
          {listings&&testCount>0&&<div style={{display:'flex',alignItems:'center',gap:8,marginLeft:8,padding:'4px 12px',borderRadius:6,background:includeTest?'transparent':COLORS.amber+'18',border:'1px solid '+(includeTest?COLORS.border:COLORS.amber+'66')}}>
            <span style={{fontSize:12,color:includeTest?COLORS.dimmed:COLORS.amber,fontWeight:500}}>Test Listings</span>
            <div onClick={()=>setIncludeTest(p=>!p)} style={{width:36,height:20,borderRadius:10,background:includeTest?COLORS.green+'66':COLORS.border,cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
              <div style={{width:16,height:16,borderRadius:8,background:includeTest?COLORS.green:'#fff',position:'absolute',top:2,left:includeTest?18:2,transition:'left 0.2s, background 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}/>
            </div>
          </div>}
          {listings&&uniqueRegions.length>1&&<Select value={selectedRegion} onValueChange={setSelectedRegion}>
            <SelectTrigger style={{width:200,background:COLORS.card,border:'1px solid '+COLORS.border,color:COLORS.text,fontSize:12,height:28,borderRadius:6}}><SelectValue placeholder='All Regions'/></SelectTrigger>
            <SelectContent>
              <SelectItem value='__all__'>All Regions</SelectItem>
              {uniqueRegions.map(r=><SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>}
        </div>
      </div>
    </div>
    <div style={{maxWidth:1400,margin:'0 auto',padding:'24px 32px'}}>
      {selectedRegion!=='__all__'&&listings&&<div style={{background:COLORS.blue+'15',border:'1px solid '+COLORS.blue+'44',borderRadius:8,padding:'10px 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:13,color:COLORS.blue,fontWeight:600}}>Filtered to: {selectedRegion}</span>
          <span style={{fontSize:12,color:COLORS.muted}}>— showing {filteredListings?.length.toLocaleString()} of {listings.length.toLocaleString()} listings across all tabs</span>
        </div>
        <button onClick={()=>setSelectedRegion('__all__')} style={{fontSize:11,color:COLORS.blue,background:'transparent',border:'1px solid '+COLORS.blue+'44',borderRadius:4,padding:'3px 10px',cursor:'pointer',fontWeight:600}}>Show All Regions</button>
      </div>}
      {!includeTest&&listings&&<div style={{background:COLORS.amber+'15',border:'1px solid '+COLORS.amber+'44',borderRadius:8,padding:'10px 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:16}}>&#9888;</span>
          <span style={{fontSize:13,color:COLORS.amber,fontWeight:600}}>Excluding {testCount} test listing{testCount!==1?'s':''}{referralsLoaded&&referralParser.metadata?' and referral test rows in analytics':''}</span>
          <span style={{fontSize:12,color:COLORS.muted}}>— showing {(listings.length-testCount).toLocaleString()} of {listings.length.toLocaleString()} listings{referralsLoaded&&referralParser.metadata&&referralAnalytics?' and '+referralAnalytics.total.toLocaleString()+' referral rows in current filter':''} across all tabs</span>
        </div>
        <button onClick={()=>setIncludeTest(true)} style={{fontSize:11,color:COLORS.amber,background:'transparent',border:'1px solid '+COLORS.amber+'44',borderRadius:4,padding:'3px 10px',cursor:'pointer',fontWeight:600}}>Include All</button>
      </div>}
      {!allLoaded&&<div style={{marginBottom:32}}>
        <h2 style={{fontSize:16,fontWeight:700,marginBottom:16,color:COLORS.muted}}>Load your Regional Authority export files to begin</h2>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16}}>
          <Upload label='Export Listings' desc='Upload the Listings export (.xlsx)' loaded={!!listings&&listings.length>0} error={parseErrors.listings} onError={message=>setParseErrors(p=>({...p,listings:message}))} onLoad={buf=>{const r=parseFile(buf,LISTING_MAP);if(r.error){setParseErrors(p=>({...p,listings:r.error||'Unable to parse Listings file.'}));return;}setParseErrors(p=>({...p,listings:''}));setListings(r.rows);setListingHeaders(r.headerDiag);}}/>
          <Upload label='Export Sites' desc='Upload the Sites export (.xlsx)' loaded={!!sites&&sites.length>0} error={parseErrors.sites} onError={message=>setParseErrors(p=>({...p,sites:message}))} onLoad={buf=>{const r=parseFile(buf,SITE_MAP);if(r.error){setParseErrors(p=>({...p,sites:r.error||'Unable to parse Sites file.'}));return;}setParseErrors(p=>({...p,sites:''}));setSites(r.rows);setSiteHeaders(r.headerDiag);}}/>
          <Upload label='Export Users' desc='Upload the Users export (.xlsx)' loaded={!!users&&users.length>0} error={parseErrors.users} onError={message=>setParseErrors(p=>({...p,users:message}))} onLoad={buf=>{const r=parseFile(buf,USER_MAP);if(r.error){setParseErrors(p=>({...p,users:r.error||'Unable to parse Users file.'}));return;}setParseErrors(p=>({...p,users:''}));setUsers(r.rows);setUserHeaders(r.headerDiag);}}/>
          <Upload label='Referral Analytics' desc='Upload the Referral Analytics export (.xlsx or .csv)' loaded={referralsLoaded} error={parseErrors.referrals} onError={message=>setParseErrors(p=>({...p,referrals:message}))} isLoading={referralParser.isLoading} progress={referralParser.progress} onFile={file=>{setParseErrors(p=>({...p,referrals:''}));const route=chooseIngestRoute();referralParser.ingest(file,REFERRAL_MAP,USED_FIELDS,'referrals',{sites,listings,users},route);}}/>
        </div>
        {Object.values(parseErrors).some(Boolean)&&<div style={{marginTop:12,display:'grid',gap:6}}>
          {Object.entries(parseErrors).filter(([,v])=>!!v).map(([k,v])=><div key={k} style={{background:COLORS.red+'14',border:'1px solid '+COLORS.red+'55',borderRadius:8,padding:'8px 12px',fontSize:12,color:COLORS.red,fontWeight:600,textTransform:'capitalize'}}>{k}: {v}</div>)}
        </div>}
        {anyLoaded&&!allLoaded&&<p style={{fontSize:13,color:COLORS.amber,marginTop:12}}>Upload Listings, Sites, and Users for complete cross-file analytics. Referral Analytics is optional.</p>}
      </div>}
      {allLoaded&&<div style={{display:'flex',gap:12,marginBottom:20,alignItems:'center',flexWrap:'wrap'}}>
        <button onClick={()=>{setListings(null);setSites(null);setUsers(null);setReferralsLoaded(false);referralParser.reset();setParseErrors({});setListingHeaders([]);setSiteHeaders([]);setUserHeaders([]);setReferralHeaders([]);setSelectedRegion('__all__');setTab('overview');}} style={{fontSize:12,color:COLORS.dimmed,background:COLORS.card,border:'1px solid '+COLORS.border,borderRadius:6,padding:'6px 14px',cursor:'pointer'}}>↻ Reload files</button>
        {!referralsLoaded&&<Upload label='Referral Analytics' desc='Upload to enable referral tab (.xlsx or .csv)' loaded={false} error={parseErrors.referrals} onError={message=>setParseErrors(p=>({...p,referrals:message}))} isLoading={referralParser.isLoading} progress={referralParser.progress} onFile={file=>{setParseErrors(p=>({...p,referrals:''}));const route=chooseIngestRoute();referralParser.ingest(file,REFERRAL_MAP,USED_FIELDS,'referrals',{sites,listings,users},route);}}/>}
      </div>}
      {anyLoaded&&<Tabs value={tab} onValueChange={setTab}>
        <TabsList style={{background:COLORS.card,borderRadius:8,marginBottom:24,border:'1px solid '+COLORS.border}}>
          <TabsTrigger value='overview'>Overview</TabsTrigger>
          <TabsTrigger value='listings'>Listings & eReferral</TabsTrigger>
          <TabsTrigger value='onboarding'>Onboarding Timeline</TabsTrigger>
          <TabsTrigger value='geography'>Geographic</TabsTrigger>
          <TabsTrigger value='sites'>Site Maturity</TabsTrigger>
          <TabsTrigger value='staffing'>Staffing</TabsTrigger>
          <TabsTrigger value='referrals'>Referral Activity</TabsTrigger>
          <TabsTrigger value='dataquality'>Data Quality</TabsTrigger>
        </TabsList>
        <TabsContent value='overview'>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
            {listingStats&&<><KPI label='Total Listings' value={listingStats.total} color={COLORS.accent}/><KPI label='eReferral Enabled' value={listingStats.eRefEnabled} sub={percentage(listingStats.eRefEnabled,listingStats.total)+'% of listings'} color={COLORS.green}/><KPI label='eConsult Enabled' value={listingStats.eConEnabled} sub={percentage(listingStats.eConEnabled,listingStats.total)+'% of listings'} color={COLORS.purple}/><KPI label='RA Approved' value={listingStats.approved} sub={listingStats.pending+' pending'} color={COLORS.amber}/></>}
            {siteStats&&<><KPI label='Total Sites' value={siteStats.total} color={COLORS.blue}/><KPI label='Validated Sites' value={siteStats.validated} sub={percentage(siteStats.validated,siteStats.total)+'% validated'} color={COLORS.green}/><KPI label='Monthly Licence Fees' value={'$'+siteStats.totalFees.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} color={COLORS.amber}/><KPI label='Sites with Listings' value={siteStats.withListings} sub={percentage(siteStats.withListings,siteStats.total)+'% active'} color={COLORS.accent}/></>}
            {userStats&&<><KPI label='Total Users' value={userStats.total} color={COLORS.accent}/><KPI label='Valid Agreements' value={userStats.valid} sub={percentage(userStats.valid,userStats.total)+'% valid'} color={COLORS.green}/><KPI label='Roles Represented' value={Object.keys(userStats.roleMap).length} color={COLORS.purple}/><KPI label='Agreement Versions' value={Object.keys(userStats.versionMap).length} color={COLORS.blue}/></>}
          </div>
          {listingStats&&<div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24,marginBottom:20}}>
            <h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>eReferral Adoption Funnel</h3>
            <Funnel steps={[{label:'Total Listings',value:listingStats.total,color:COLORS.accent},{label:'RA Approved',value:listingStats.approved,color:COLORS.blue},{label:'Cloud Connect On',value:listingStats.ccEnabled,color:COLORS.purple},{label:'SEK Stored',value:listingStats.sekStored,color:COLORS.amber},{label:'eReferral Enabled',value:listingStats.eRefEnabled,color:COLORS.green},{label:'Contributing to Repo',value:listingStats.contributing,color:'#2dd4bf'}]}/>
          </div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            {listingStats&&<div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Trustee / Custodian Status</h3><Donut segments={[{label:'Trustee/Custodian',value:listingStats.trustee,color:COLORS.green},{label:'Non-Trustee',value:listingStats.nonTrustee,color:COLORS.blue},{label:'Unspecified',value:listingStats.unspecTrustee,color:COLORS.amber},{label:'Not Accepting',value:listingStats.notAccepting,color:COLORS.red}]}/></div>}
            {userStats&&<div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>User Roles Distribution</h3><Donut segments={Object.entries(userStats.roleMap).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label,value],i)=>({label,value,color:[COLORS.accent,COLORS.green,COLORS.purple,COLORS.amber,COLORS.blue,COLORS.red,'#f472b6','#a3e635'][i]}))}/></div>}
          </div>
        </TabsContent>
        <TabsContent value='listings'>
          {listingStats&&filteredListings&&<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:14,marginBottom:24}}>
              <KPI label='eReferral Enabled' value={listingStats.eRefEnabled} sub={percentage(listingStats.eRefEnabled,listingStats.total)+'%'} color={COLORS.green}/><KPI label='eConsult Enabled' value={listingStats.eConEnabled} sub={percentage(listingStats.eConEnabled,listingStats.total)+'%'} color={COLORS.purple}/><KPI label='In Test Mode' value={includeTest?listingStats.testMode:testCount} sub={includeTest?'not yet live':'excluded by filter'} color={includeTest?COLORS.amber:COLORS.dimmed}/><KPI label='CC Enabled' value={listingStats.ccEnabled} sub={percentage(listingStats.ccEnabled,listingStats.total)+'%'} color={COLORS.blue}/><KPI label='Contributing' value={listingStats.contributing} sub={percentage(listingStats.contributing,listingStats.total)+'%'} color='#2dd4bf'/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Listing Type Breakdown</h3><Bar data={Object.entries(listingStats.typeMap).sort((a,b)=>b[1]-a[1]).map(([l,v])=>({label:l.replace(/_/g,' ').substring(0,22),value:v}))} color={COLORS.accent}/></div>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>eReferral vs eConsult</h3><Donut size={150} segments={[{label:'eReferral Only',value:listingStats.eRefEnabled-filteredListings.filter(l=>l.eReferrals==='ENABLED'&&l.eConsults==='ENABLED').length,color:COLORS.green},{label:'eConsult Only',value:listingStats.eConEnabled-filteredListings.filter(l=>l.eReferrals==='ENABLED'&&l.eConsults==='ENABLED').length,color:COLORS.purple},{label:'Both',value:filteredListings.filter(l=>l.eReferrals==='ENABLED'&&l.eConsults==='ENABLED').length,color:COLORS.accent},{label:'Neither',value:listingStats.total-listingStats.eRefEnabled-listingStats.eConEnabled+filteredListings.filter(l=>l.eReferrals==='ENABLED'&&l.eConsults==='ENABLED').length,color:COLORS.red}]}/></div>
            </div>
            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
              <h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Technical Readiness Scorecard</h3>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:20}}>
                {[{label:'Cloud Connect Enabled',n:listingStats.ccEnabled,t:listingStats.total,c:COLORS.accent},{label:'SEK Stored',n:listingStats.sekStored,t:listingStats.total,c:COLORS.purple},{label:'Repository Contributing',n:listingStats.contributing,t:listingStats.total,c:COLORS.green}].map((it,i)=><div key={i} style={{textAlign:'center'}}><div style={{fontSize:32,fontWeight:800,color:it.c}}>{percentage(it.n,it.t)}%</div><Progress value={percentage(it.n,it.t)} style={{height:6,marginTop:8,background:COLORS.border}}/><div style={{fontSize:12,color:COLORS.muted,marginTop:8}}>{it.label}</div><div style={{fontSize:11,color:COLORS.dimmed}}>{formatNumber(it.n)} / {formatNumber(it.t)}</div></div>)}
              </div>
            </div>
          </>}
        </TabsContent>
        <TabsContent value='onboarding'>
          {userStats&&<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
              <KPI label='Total Users Onboarded' value={userStats.total} color={COLORS.accent}/><KPI label='Currently Valid' value={userStats.valid} sub={percentage(userStats.valid,userStats.total)+'% retention'} color={COLORS.green}/><KPI label='Earliest Agreement' value={userStats.timeline.length>0?userStats.timeline[0].label:'N/A'} color={COLORS.muted}/><KPI label='Latest Agreement' value={userStats.timeline.length>0?userStats.timeline[userStats.timeline.length-1].label:'N/A'} color={COLORS.accent}/>
            </div>
            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24,marginBottom:20}}>
              <h3 style={{fontSize:15,fontWeight:700,marginBottom:4,marginTop:0}}>Cumulative User Onboarding Over Time</h3>
              <p style={{fontSize:12,color:COLORS.dimmed,marginBottom:16,marginTop:0}}>Based on Date of Agreement</p>
              <Area data={userStats.timeline} color={COLORS.accent} height={240}/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Monthly New Users</h3><Bar data={userStats.timeline.slice(-24).map(d=>({label:d.label,value:d.value}))} color={COLORS.green} height={180}/></div>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Licence Agreement Versions</h3><Donut segments={Object.entries(userStats.versionMap).sort((a,b)=>b[1]-a[1]).map(([l,v],i)=>({label:l||'Unknown',value:v,color:[COLORS.accent,COLORS.green,COLORS.purple,COLORS.amber,COLORS.blue,COLORS.red][i%6]}))}/></div>
            </div>
          </>}
        </TabsContent>
        <TabsContent value='geography'>
          {listingStats&&<>
            <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:20}}>
              <span style={{fontSize:13,color:COLORS.muted}}>Group by:</span>
              <Select value={geoGroupField} onValueChange={(v:any)=>setGeoGroupField(v)}>
                <SelectTrigger style={{width:200,background:COLORS.card,border:'1px solid '+COLORS.border,color:COLORS.text}}><SelectValue/></SelectTrigger>
                <SelectContent><SelectItem value='province'>Province</SelectItem><SelectItem value='healthRegion'>Health Region</SelectItem><SelectItem value='city'>City</SelectItem></SelectContent>
              </Select>
            </div>
            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24,marginBottom:20}}>
              <h3 style={{fontSize:15,fontWeight:700,margin:0,marginBottom:16}}>eReferral Adoption by {geoGroupField==='healthRegion'?'Health Region':geoGroupField==='province'?'Province':'City'}</h3>
              <ScrollArea style={{maxHeight:500}}><Geo data={listingStats.geoData}/></ScrollArea>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:12,marginTop:0,color:COLORS.green}}>Highest Adoption</h3>{listingStats.geoData.filter(d=>d.total>=2).sort((a,b)=>b.rate-a.rate).slice(0,8).map((d,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid '+COLORS.border}}><span style={{fontSize:13,color:COLORS.text}}>{d.region||'Unspecified'}</span><span style={{fontSize:13,fontWeight:700,color:COLORS.green}}>{d.rate}% <span style={{fontWeight:400,color:COLORS.dimmed}}>({d.enabled}/{d.total})</span></span></div>)}</div>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:12,marginTop:0,color:COLORS.red}}>Lowest Adoption</h3>{listingStats.geoData.filter(d=>d.total>=2).sort((a,b)=>a.rate-b.rate).slice(0,8).map((d,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid '+COLORS.border}}><span style={{fontSize:13,color:COLORS.text}}>{d.region||'Unspecified'}</span><span style={{fontSize:13,fontWeight:700,color:d.rate<30?COLORS.red:COLORS.amber}}>{d.rate}% <span style={{fontWeight:400,color:COLORS.dimmed}}>({d.enabled}/{d.total})</span></span></div>)}</div>
            </div>
          </>}
        </TabsContent>
        <TabsContent value='sites'>
          {siteStats&&<div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}><KPI label='Total Sites' value={siteStats.total} color={COLORS.accent}/><KPI label='Validated' value={siteStats.validated} sub={percentage(siteStats.validated,siteStats.total)+'%'} color={COLORS.green}/><KPI label='Patient Messaging' value={siteStats.pmEnabled} sub={siteStats.totalPmLic+' licences'} color={COLORS.purple}/><KPI label='Online Booking' value={siteStats.obEnabled} sub={siteStats.totalObLic+' licences'} color={COLORS.blue}/></div>}
          {siteStats&&<div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24,marginBottom:20}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>EMR Distribution</h3><Bar data={Object.entries(siteStats.emrMap).sort((a,b)=>b[1]-a[1]).map(([l,v])=>({label:l||'None',value:v}))} color={COLORS.purple} height={160}/></div>}
          {filteredSiteMaturity&&<div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:12}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <h3 style={{fontSize:15,fontWeight:700,margin:0}}>Site Maturity Detail</h3>
                <span style={{fontSize:12,color:COLORS.dimmed,background:COLORS.border,padding:'2px 8px',borderRadius:10}}>{filteredSiteMaturity.length}{siteSearchQuery?' filtered':''} of {siteMaturity?.length} sites</span>
              </div>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <input type='text' placeholder='Search sites...' value={siteSearchQuery} onChange={e=>setSiteSearchQuery(e.target.value)} style={{background:COLORS.background,border:'1px solid '+COLORS.border,borderRadius:6,padding:'7px 12px',color:COLORS.text,fontSize:13,width:220,outline:'none'}}/>
                <button onClick={()=>{if(!filteredSiteMaturity)return;exportToExcel(filteredSiteMaturity.map(s=>({'Site Number':s.siteNum,'Site Name':s.siteName,EMR:s.emr||'','Total Listings':s.total,'eReferral Enabled':s.eRefEnabled,'eConsult Enabled':s.eConEnabled,'CC Enabled':s.ccEnabled,'Adoption Rate %':s.adoptionRate,Users:s.userCount,Validated:s.validated?'TRUE':'FALSE'})),'site-maturity-'+new Date().toISOString().slice(0,10)+'.xlsx');}} style={{background:'linear-gradient(135deg,'+COLORS.accent+'22,'+COLORS.accent+'11)',border:'1px solid '+COLORS.accent+'44',borderRadius:6,padding:'7px 16px',color:COLORS.accent,fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Export to Excel</button>
              </div>
            </div>
            <div style={{maxHeight:600,overflowY:'auto',borderRadius:8,border:'1px solid '+COLORS.border+'22'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                  <tr style={{borderBottom:'2px solid '+COLORS.border}}>
                    <th style={sortHeaderStyle(siteSortField,'siteNum',COLORS.border)} onClick={()=>doSort('siteNum')}>Site #{sortIcon(siteSortField,siteSortDir,'siteNum')}</th>
                    <th style={sortHeaderStyle(siteSortField,'siteName',COLORS.border)} onClick={()=>doSort('siteName')}>Site Name{sortIcon(siteSortField,siteSortDir,'siteName')}</th>
                    <th style={sortHeaderStyle(siteSortField,'emr',COLORS.border)} onClick={()=>doSort('emr')}>EMR{sortIcon(siteSortField,siteSortDir,'emr')}</th>
                    <th style={sortHeaderStyle(siteSortField,'total',COLORS.border)} onClick={()=>doSort('total')}>Listings{sortIcon(siteSortField,siteSortDir,'total')}</th>
                    <th style={sortHeaderStyle(siteSortField,'eRefEnabled',COLORS.border)} onClick={()=>doSort('eRefEnabled')}>eRef{sortIcon(siteSortField,siteSortDir,'eRefEnabled')}</th>
                    <th style={sortHeaderStyle(siteSortField,'adoptionRate',COLORS.border)} onClick={()=>doSort('adoptionRate')}>Adopt %{sortIcon(siteSortField,siteSortDir,'adoptionRate')}</th>
                    <th style={sortHeaderStyle(siteSortField,'userCount',COLORS.border)} onClick={()=>doSort('userCount')}>Users{sortIcon(siteSortField,siteSortDir,'userCount')}</th>
                    <th style={sortHeaderStyle(siteSortField,'validated',COLORS.border)} onClick={()=>doSort('validated')}>Valid{sortIcon(siteSortField,siteSortDir,'validated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSiteMaturity.map((s,i)=><tr key={i} style={{borderBottom:'1px solid '+COLORS.border+'22'}} onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=COLORS.border+'33';}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent';}}>
                    <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:COLORS.dimmed}}>{s.siteNum}</td>
                    <td style={{padding:'8px 10px',color:COLORS.text,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.siteName}>{s.siteName}</td>
                    <td style={{padding:'8px 10px',color:COLORS.muted}}>{s.emr||'—'}</td>
                    <td style={{padding:'8px 10px',color:COLORS.text,fontWeight:600}}>{s.total}</td>
                    <td style={{padding:'8px 10px',color:COLORS.green,fontWeight:600}}>{s.eRefEnabled}</td>
                    <td style={{padding:'8px 10px'}}><div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:50,height:6,background:COLORS.border,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:s.adoptionRate+'%',background:s.adoptionRate>=70?COLORS.green:s.adoptionRate>=40?COLORS.amber:COLORS.red,borderRadius:3}}/></div><span style={{fontWeight:600,color:s.adoptionRate>=70?COLORS.green:s.adoptionRate>=40?COLORS.amber:COLORS.red}}>{s.adoptionRate}%</span></div></td>
                    <td style={{padding:'8px 10px',color:COLORS.accent,fontWeight:600}}>{s.userCount}</td>
                    <td style={{padding:'8px 10px'}}>{s.validated?<span style={{color:COLORS.green}}>✓</span>:<span style={{color:COLORS.dimmed}}>—</span>}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {filteredSiteMaturity.length===0&&<div style={{textAlign:'center',padding:'32px 0',color:COLORS.dimmed}}>No sites match your search.</div>}
          </div>}
        </TabsContent>
        <TabsContent value='staffing'>
          {filteredStaff&&listings&&<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
              <KPI label='Sites Analyzed' value={filteredStaff.length} color={COLORS.accent}/>
              <KPI label='Total Users' value={filteredStaff.reduce((s,r)=>s+r.userCount,0)} color={COLORS.blue}/>
              <KPI label='Total RA Clinicians' value={filteredStaff.reduce((s,r)=>s+r.raClinTotal,0)} sub='declared across all listings' color={COLORS.purple}/>
              <KPI label='Sites with Gap' value={filteredStaff.filter(s=>s.absDelta>0).length} sub={percentage(filteredStaff.filter(s=>s.absDelta>0).length,filteredStaff.length)+'% of sites'} color={COLORS.amber}/>
            </div>
            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:12}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <h3 style={{fontSize:15,fontWeight:700,margin:0}}>Staffing Reconciliation</h3>
                  <span style={{fontSize:12,color:COLORS.dimmed,background:COLORS.border,padding:'2px 8px',borderRadius:10}}>{filteredStaff.length}{staffSearchQuery?' filtered':''} of {staffing?.length} sites</span>
                </div>
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  <input type='text' placeholder='Search sites...' value={staffSearchQuery} onChange={e=>setStaffSearchQuery(e.target.value)} style={{background:COLORS.background,border:'1px solid '+COLORS.border,borderRadius:6,padding:'7px 12px',color:COLORS.text,fontSize:13,width:220,outline:'none'}}/>
                  <button onClick={()=>{if(!filteredStaff)return;exportToExcel(filteredStaff.map(s=>({'Site Number':s.siteNum,'Site Name':s.siteName,Users:s.userCount,'RA Clinicians Declared':s.raClinTotal,Delta:s.delta,'Abs Gap':s.absDelta,Listings:s.listingCount})),'staffing-reconciliation-'+new Date().toISOString().slice(0,10)+'.xlsx');}} style={{background:'linear-gradient(135deg,'+COLORS.accent+'22,'+COLORS.accent+'11)',border:'1px solid '+COLORS.accent+'44',borderRadius:6,padding:'7px 16px',color:COLORS.accent,fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Export to Excel</button>
                </div>
              </div>
              <div style={{fontSize:12,color:COLORS.muted,marginBottom:16,display:'flex',gap:20,flexWrap:'wrap'}}>
                <span><strong style={{color:COLORS.text}}>Users</strong> = Ocean accounts linked to site</span>
                <span><strong style={{color:COLORS.text}}>RA Clinicians</strong> = declared authorized clinicians across listings</span>
                <span><strong style={{color:COLORS.text}}>Delta</strong> = Users minus RA Clinicians (positive = more users than declared)</span>
              </div>
              <div style={{maxHeight:650,overflowY:'auto',borderRadius:8,border:'1px solid '+COLORS.border+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                    <tr style={{borderBottom:'2px solid '+COLORS.border}}>
                      <th style={{...sortHeaderStyle(staffSortField,'_',COLORS.border),width:30,cursor:'default'}}></th>
                      <th style={sortHeaderStyle(staffSortField,'siteNum',COLORS.border)} onClick={()=>doStSort('siteNum')}>Site #{sortIcon(staffSortField,staffSortDir,'siteNum')}</th>
                      <th style={sortHeaderStyle(staffSortField,'siteName',COLORS.border)} onClick={()=>doStSort('siteName')}>Site Name{sortIcon(staffSortField,staffSortDir,'siteName')}</th>
                      <th style={sortHeaderStyle(staffSortField,'userCount',COLORS.border)} onClick={()=>doStSort('userCount')}>Users{sortIcon(staffSortField,staffSortDir,'userCount')}</th>
                      <th style={sortHeaderStyle(staffSortField,'raClinTotal',COLORS.border)} onClick={()=>doStSort('raClinTotal')}>RA Clinicians{sortIcon(staffSortField,staffSortDir,'raClinTotal')}</th>
                      <th style={sortHeaderStyle(staffSortField,'delta',COLORS.border)} onClick={()=>doStSort('delta')}>Delta{sortIcon(staffSortField,staffSortDir,'delta')}</th>
                      <th style={sortHeaderStyle(staffSortField,'absDelta',COLORS.border)} onClick={()=>doStSort('absDelta')}>Gap{sortIcon(staffSortField,staffSortDir,'absDelta')}</th>
                      <th style={sortHeaderStyle(staffSortField,'listingCount',COLORS.border)} onClick={()=>doStSort('listingCount')}>Listings{sortIcon(staffSortField,staffSortDir,'listingCount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStaff.map((s,i)=>{const isExp=expandedSite===s.siteNum;return(<>
                      <tr key={'r'+i} style={{borderBottom:'1px solid '+COLORS.border+'22',cursor:'pointer',background:isExp?COLORS.border+'44':'transparent'}} onClick={()=>setExpandedSite(isExp?null:s.siteNum)} onMouseEnter={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background=COLORS.border+'33';}} onMouseLeave={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background='transparent';}}>
                        <td style={{padding:'8px 6px',textAlign:'center',fontSize:14,color:COLORS.dimmed,transition:'transform 0.2s',transform:isExp?'rotate(90deg)':'rotate(0deg)'}}>&#9656;</td>
                        <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:COLORS.dimmed}}>{s.siteNum}</td>
                        <td style={{padding:'8px 10px',color:COLORS.text,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.siteName}>{s.siteName}</td>
                        <td style={{padding:'8px 10px',color:COLORS.blue,fontWeight:600}}>{s.userCount}</td>
                        <td style={{padding:'8px 10px',color:COLORS.purple,fontWeight:600}}>{s.raClinTotal}</td>
                        <td style={{padding:'8px 10px',fontWeight:700,color:deltaColor(s.delta,s.raClinTotal)}}>{s.delta>0?'+':''}{s.delta}</td>
                        <td style={{padding:'8px 10px'}}><div style={{display:'flex',alignItems:'center',gap:6}}>
                          <div style={{width:40,height:6,background:COLORS.border,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:Math.min(s.absDelta/(Math.max(s.raClinTotal,s.userCount,1))*100,100)+'%',background:deltaColor(s.delta,s.raClinTotal),borderRadius:3}}/></div>
                          <span style={{fontWeight:600,color:deltaColor(s.delta,s.raClinTotal)}}>{s.absDelta}</span>
                        </div></td>
                        <td style={{padding:'8px 10px',color:COLORS.text}}>{s.listingCount}</td>
                      </tr>
                      {isExp&&s.details.length>0&&<tr key={'d'+i}><td colSpan={8} style={{padding:0}}>
                        <div style={{background:COLORS.background,borderTop:'1px solid '+COLORS.border,borderBottom:'1px solid '+COLORS.border,padding:'12px 20px 12px 46px'}}>
                          <div style={{fontSize:11,color:COLORS.dimmed,fontWeight:700,textTransform:'uppercase',marginBottom:8,letterSpacing:0.5}}>Listings for {s.siteName}</div>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                            <thead><tr style={{borderBottom:'1px solid '+COLORS.border}}>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Ref</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Listing Title</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Type</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>RA Clinicians</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>eReferral</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>eConsult</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Claimed By</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Clinician Prof ID</th>
                            </tr></thead>
                            <tbody>{s.details.map((d,j)=><tr key={j} style={{borderBottom:'1px solid '+COLORS.border+'22'}}>
                              <td style={{padding:'5px 8px',fontFamily:"'JetBrains Mono'",color:COLORS.dimmed}}>{d.ref}</td>
                              <td style={{padding:'5px 8px',color:COLORS.text,maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={d.title}>{d.title}</td>
                              <td style={{padding:'5px 8px',color:COLORS.muted}}>{(d.listingType||'').replace(/_/g,' ')}</td>
                              <td style={{padding:'5px 8px',fontWeight:700,color:d.raClinCount>0?COLORS.purple:COLORS.dimmed}}>{d.raClinCount}</td>
                              <td style={{padding:'5px 8px'}}><span style={{padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:d.eReferrals==='ENABLED'?COLORS.green+'22':COLORS.red+'22',color:d.eReferrals==='ENABLED'?COLORS.green:COLORS.red}}>{d.eReferrals==='ENABLED'?'ON':'OFF'}</span></td>
                              <td style={{padding:'5px 8px'}}><span style={{padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:d.eConsults==='ENABLED'?COLORS.purple+'22':COLORS.border,color:d.eConsults==='ENABLED'?COLORS.purple:COLORS.dimmed}}>{d.eConsults==='ENABLED'?'ON':'OFF'}</span></td>
                              <td style={{padding:'5px 8px',color:d.claimedByUser?COLORS.text:COLORS.dimmed,fontStyle:d.claimedByUser?'normal':'italic'}}>{d.claimedByUser||'unclaimed'}</td>
                              <td style={{padding:'5px 8px',fontFamily:"'JetBrains Mono'",color:d.clinicianProfId?COLORS.text:COLORS.dimmed,fontStyle:d.clinicianProfId?'normal':'italic'}}>{d.clinicianProfId||'—'}</td>
                            </tr>)}</tbody>
                          </table>
                          <div style={{marginTop:8,fontSize:11,color:COLORS.muted}}>Site total: <strong style={{color:COLORS.purple}}>{s.raClinTotal}</strong> RA clinicians across <strong style={{color:COLORS.text}}>{s.listingCount}</strong> listings | <strong style={{color:COLORS.blue}}>{s.userCount}</strong> Ocean users linked</div>
                        </div>
                      </td></tr>}
                    </>);})}
                  </tbody>
                </table>
              </div>
              {filteredStaff.length===0&&<div style={{textAlign:'center',padding:'32px 0',color:COLORS.dimmed}}>No sites match your search.</div>}
            </div>
          </>}
        </TabsContent>
        <TabsContent value='referrals'>
          {referralAnalytics&&filteredReferralData?<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:14}}>
              <KPI label='Total Referrals (All Time)' value={referralAnalytics.distinctRefs} sub={referralAnalytics.distinctRefs!==referralAnalytics.total?referralAnalytics.total+' rows':'distinct referral IDs'} color={COLORS.accent}/>
              <KPI label='Unique Senders' value={referralAnalytics.uniqueProfIds} sub={referralAnalytics.uniqueSenders+' usernames'} color={COLORS.green}/>
              <KPI label='Unique Receivers' value={referralAnalytics.uniqueTargetRefs} sub='distinct target listings' color={COLORS.purple}/>
              <KPI label='Unique Sending Sites' value={referralAnalytics.uniqueSendingSites} sub={referralAnalytics.uniqueTargetSites+' target sites'} color={COLORS.blue}/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
              <KPI label={'Current Month ('+referralAnalytics.curM+')'} value={formatNumber(referralAnalytics.curMCount)} sub='partial month in progress' color={COLORS.accent}/>
              <KPI label={'1 Month Change'} value={referralAnalytics.chg1.val} sub={referralAnalytics.chg1.val==='N/A'?'No data for '+referralAnalytics.cmp1M+(referralAnalytics.earliestDate?'. Data starts '+referralAnalytics.earliestDate:''):referralAnalytics.lastFullM+' ('+formatNumber(referralAnalytics.lastFullCount)+') vs '+referralAnalytics.cmp1M+' ('+formatNumber(referralAnalytics.cmp1Count)+')'} color={referralAnalytics.chg1.val==='N/A'?COLORS.dimmed:referralAnalytics.chg1.num>=0?COLORS.green:COLORS.red}/>
              <KPI label={'3 Month Change'} value={referralAnalytics.chg3.val} sub={referralAnalytics.chg3.val==='N/A'?'No data for '+referralAnalytics.cmp3M+(referralAnalytics.earliestDate?'. Data starts '+referralAnalytics.earliestDate:''):referralAnalytics.lastFullM+' ('+formatNumber(referralAnalytics.lastFullCount)+') vs '+referralAnalytics.cmp3M+' ('+formatNumber(referralAnalytics.cmp3Count)+')'} color={referralAnalytics.chg3.val==='N/A'?COLORS.dimmed:referralAnalytics.chg3.num>=0?COLORS.green:COLORS.red}/>
              <KPI label={'12 Month Change'} value={referralAnalytics.chg12.val} sub={referralAnalytics.chg12.val==='N/A'?'No data for '+referralAnalytics.cmp12M+(referralAnalytics.earliestDate?'. Data starts '+referralAnalytics.earliestDate:''):referralAnalytics.lastFullM+' ('+formatNumber(referralAnalytics.lastFullCount)+') vs '+referralAnalytics.cmp12M+' ('+formatNumber(referralAnalytics.cmp12Count)+')'} color={referralAnalytics.chg12.val==='N/A'?COLORS.dimmed:referralAnalytics.chg12.num>=0?COLORS.green:COLORS.red}/>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <h3 style={{fontSize:15,fontWeight:700,marginBottom:4,marginTop:0}}>Cumulative Referral Volume</h3>
                <p style={{fontSize:12,color:COLORS.dimmed,marginBottom:12,marginTop:0}}>Based on referral creation date</p>
                <Area data={referralAnalytics.timeline} color={COLORS.accent} height={200}/>
              </div>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <h3 style={{fontSize:15,fontWeight:700,marginBottom:4,marginTop:0}}>Monthly Referral Volume</h3>
                <p style={{fontSize:12,color:COLORS.dimmed,marginBottom:12,marginTop:0}}>Referrals created per month</p>
                <Bar data={referralAnalytics.timeline.slice(-24).map(d=>({label:d.label,value:d.value}))} color={COLORS.green} height={200}/>
              </div>
            </div>

            {referralAnalytics.weekly.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:20}}>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:4,marginTop:0}}>Referrals Per Week</h3>
                <p style={{fontSize:11,color:COLORS.dimmed,marginBottom:8,marginTop:0}}>Test (amber) vs non-test (green)</p>
                <MiniBar data={referralAnalytics.weekly.slice(-26).map(w=>({label:w.label,primary:w.nonTest,secondary:w.test}))} color={COLORS.green} stacked/>
              </div>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:4,marginTop:0}}>Unique Senders Per Week</h3>
                <p style={{fontSize:11,color:COLORS.dimmed,marginBottom:8,marginTop:0}}>Distinct professional IDs, excl. test</p>
                <MiniBar data={referralAnalytics.weekly.slice(-26).map(w=>({label:w.label,primary:w.senders}))} color={COLORS.blue}/>
              </div>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:4,marginTop:0}}>Unique Receivers Per Week</h3>
                <p style={{fontSize:11,color:COLORS.dimmed,marginBottom:8,marginTop:0}}>Distinct target listing refs, excl. test</p>
                <MiniBar data={referralAnalytics.weekly.slice(-26).map(w=>({label:w.label,primary:w.receivers}))} color={COLORS.purple}/>
              </div>
            </div>}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:20}}>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:12,marginTop:0}}>Target Region</h3>
                <Donut size={140} segments={referralAnalytics.byRegion.map((d,i)=>({label:d.label,value:d.value,color:d.label==='Referrals not mapped to listings'?COLORS.red:d.label==='Region not defined'?COLORS.amber:[COLORS.accent,COLORS.green,COLORS.purple,COLORS.blue,'#f472b6','#a3e635','#fb923c','#6ee7b7',COLORS.red,COLORS.amber,'#94A3B8'][i%11]}))}/>
              </div>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:12,marginTop:0}}>Referral Categories</h3>
                <Donut size={140} segments={referralAnalytics.byService.map((d,i)=>({label:d.label.replace(/_/g,' ').substring(0,25),value:d.value,color:[COLORS.green,COLORS.accent,COLORS.purple,COLORS.amber,COLORS.blue,COLORS.red,'#f472b6','#a3e635','#fb923c','#6ee7b7','#94A3B8'][i%11]}))}/>
              </div>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:12,marginTop:0}}>Referrer Clinician Type</h3>
                <Donut size={140} segments={referralAnalytics.byClinType.map((d,i)=>({label:d.label.replace(/_/g,' ').substring(0,25),value:d.value,color:[COLORS.blue,COLORS.green,COLORS.purple,COLORS.amber,COLORS.accent,COLORS.red,'#f472b6','#a3e635','#fb923c','#6ee7b7','#94A3B8'][i%11]}))}/>
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:12,marginTop:0}}>Referrals Sent — EMR Breakdown</h3>
                <Bar data={referralAnalytics.byEmrSent.slice(0,10)} color={COLORS.blue} height={180}/>
              </div>
              <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <h3 style={{fontSize:14,fontWeight:700,margin:0}}>Referrals Received — EMR Breakdown</h3>
                  {referralAnalytics.fhirCount>0&&<span style={{fontSize:11,padding:'3px 8px',borderRadius:4,background:COLORS.accent+'22',color:COLORS.accent,fontWeight:600}}>FHIR/API: {referralAnalytics.fhirPct}% ({formatNumber(referralAnalytics.fhirCount)})</span>}
                </div>
                <Bar data={referralAnalytics.byEmrRecv.slice(0,10)} color={COLORS.purple} height={180}/>
              </div>
            </div>

            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:12}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {([['target','By Target Site',COLORS.purple],['source','By Source Site',COLORS.blue],['sender','By Sender',COLORS.green]] as [string,string,string][]).map(([val,lbl,c])=>
                    <button key={val} onClick={()=>{setReferralSection(val as any);setReferralSearchQuery('');setReferralSortField('totalRefs');setReferralSortDir('desc');setReferralExpanded(null);}} style={{fontSize:12,padding:'6px 14px',borderRadius:6,background:referralSection===val?c+'22':'transparent',color:referralSection===val?c:COLORS.dimmed,border:'1px solid '+(referralSection===val?c+'66':COLORS.border),fontWeight:600,cursor:'pointer'}}>{lbl}</button>
                  )}
                </div>
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  <input type='text' placeholder='Search...' value={referralSearchQuery} onChange={e=>setReferralSearchQuery(e.target.value)} style={{background:COLORS.background,border:'1px solid '+COLORS.border,borderRadius:6,padding:'7px 12px',color:COLORS.text,fontSize:13,width:200,outline:'none'}}/>
                  <span style={{fontSize:12,color:COLORS.dimmed,background:COLORS.border,padding:'2px 8px',borderRadius:10}}>{filteredReferralData.length} results</span>
                  {referralParser.metadata?.storageKey&&<button onClick={()=>{void exportToCSVStream(referralParser.metadata!.storageKey,'referral-data-'+new Date().toISOString().slice(0,10)+'.csv').catch((err: any)=>{if(err?.name==='AbortError') return; setParseErrors(p=>({...p,referrals:err?.message||'Failed to export referral data.'}));});}} style={{background:'linear-gradient(135deg,'+COLORS.accent+'22,'+COLORS.accent+'11)',border:'1px solid '+COLORS.accent+'44',borderRadius:6,padding:'7px 16px',color:COLORS.accent,fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Export Referral Data</button>}
                </div>
              </div>
              {referralSection==='target'&&<div style={{maxHeight:600,overflowY:'auto',borderRadius:8,border:'1px solid '+COLORS.border+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                    <tr style={{borderBottom:'2px solid '+COLORS.border}}>
                      <th style={{...sortHeaderStyle(referralSortField,'_',COLORS.border),width:30,cursor:'default'}}></th>
                      <th style={sortHeaderStyle(referralSortField,'siteNum',COLORS.border)} onClick={()=>doRtSort('siteNum')}>Site #{sortIcon(referralSortField,referralSortDir,'siteNum')}</th>
                      <th style={sortHeaderStyle(referralSortField,'siteName',COLORS.border)} onClick={()=>doRtSort('siteName')}>Site Name{sortIcon(referralSortField,referralSortDir,'siteName')}</th>
                      <th style={sortHeaderStyle(referralSortField,'totalRefs',COLORS.border)} onClick={()=>doRtSort('totalRefs')}>Referrals{sortIcon(referralSortField,referralSortDir,'totalRefs')}</th>
                      <th style={sortHeaderStyle(referralSortField,'uniqueSenders',COLORS.border)} onClick={()=>doRtSort('uniqueSenders')}>Unique Senders{sortIcon(referralSortField,referralSortDir,'uniqueSenders')}</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>State Breakdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filteredReferralData as any[]).map((s:any,i:number)=>{const isExp=referralExpanded===s.siteNum;return(<>
                      <tr key={'r'+i} style={{borderBottom:'1px solid '+COLORS.border+'22',cursor:'pointer',background:isExp?COLORS.border+'44':'transparent'}} onClick={()=>setReferralExpanded(isExp?null:s.siteNum)} onMouseEnter={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background=COLORS.border+'33';}} onMouseLeave={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background='transparent';}}>
                        <td style={{padding:'8px 6px',textAlign:'center',fontSize:14,color:COLORS.dimmed,transition:'transform 0.2s',transform:isExp?'rotate(90deg)':'rotate(0deg)'}}>&#9656;</td>
                        <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:COLORS.dimmed}}>{s.siteNum}</td>
                        <td style={{padding:'8px 10px',color:COLORS.text,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.siteName}>{s.siteName}</td>
                        <td style={{padding:'8px 10px',color:COLORS.purple,fontWeight:700}}>{formatNumber(s.totalRefs)}</td>
                        <td style={{padding:'8px 10px',color:COLORS.blue,fontWeight:600}}>{s.uniqueSenders}</td>
                        <td style={{padding:'8px 10px'}}><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{Object.entries(s.states).sort((a:any,b:any)=>b[1]-a[1]).slice(0,5).map(([st,ct]:any)=><span key={st} style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:st==='COMPLETE'||st==='ACCEPTED'?COLORS.green+'22':st==='CANCELLED'||st==='DECLINED'?COLORS.red+'22':COLORS.border,color:st==='COMPLETE'||st==='ACCEPTED'?COLORS.green:st==='CANCELLED'||st==='DECLINED'?COLORS.red:COLORS.muted,fontWeight:600}}>{st} {ct}</span>)}</div></td>
                      </tr>
                      {isExp&&s.listings.length>0&&<tr key={'d'+i}><td colSpan={6} style={{padding:0}}>
                        <div style={{background:COLORS.background,borderTop:'1px solid '+COLORS.border,borderBottom:'1px solid '+COLORS.border,padding:'12px 20px 12px 46px'}}>
                          <div style={{fontSize:11,color:COLORS.dimmed,fontWeight:700,textTransform:'uppercase',marginBottom:8,letterSpacing:0.5}}>Listings receiving referrals at {s.siteName}</div>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                            <thead><tr style={{borderBottom:'1px solid '+COLORS.border}}>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Listing Ref</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Listing Title</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Referrals</th>
                            </tr></thead>
                            <tbody>{s.listings.map((l:any,j:number)=><tr key={j} style={{borderBottom:'1px solid '+COLORS.border+'22'}}>
                              <td style={{padding:'5px 8px',fontFamily:"'JetBrains Mono'",color:COLORS.dimmed,fontSize:10}}>{l.ref}</td>
                              <td style={{padding:'5px 8px',color:COLORS.text,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={l.title}>{l.title}</td>
                              <td style={{padding:'5px 8px',color:COLORS.purple,fontWeight:700}}>{formatNumber(l.count)}</td>
                            </tr>)}</tbody>
                          </table>
                        </div>
                      </td></tr>}
                    </>);})}
                  </tbody>
                </table>
              </div>}
              {referralSection==='source'&&<div style={{maxHeight:600,overflowY:'auto',borderRadius:8,border:'1px solid '+COLORS.border+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                    <tr style={{borderBottom:'2px solid '+COLORS.border}}>
                      <th style={sortHeaderStyle(referralSortField,'siteNum',COLORS.border)} onClick={()=>doRtSort('siteNum')}>Site #{sortIcon(referralSortField,referralSortDir,'siteNum')}</th>
                      <th style={sortHeaderStyle(referralSortField,'siteName',COLORS.border)} onClick={()=>doRtSort('siteName')}>Site Name{sortIcon(referralSortField,referralSortDir,'siteName')}</th>
                      <th style={sortHeaderStyle(referralSortField,'totalRefs',COLORS.border)} onClick={()=>doRtSort('totalRefs')}>Referrals Sent{sortIcon(referralSortField,referralSortDir,'totalRefs')}</th>
                      <th style={sortHeaderStyle(referralSortField,'uniqueTargets',COLORS.border)} onClick={()=>doRtSort('uniqueTargets')}>Target Sites{sortIcon(referralSortField,referralSortDir,'uniqueTargets')}</th>
                      <th style={sortHeaderStyle(referralSortField,'uniqueUsers',COLORS.border)} onClick={()=>doRtSort('uniqueUsers')}>Unique Users{sortIcon(referralSortField,referralSortDir,'uniqueUsers')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filteredReferralData as any[]).map((s:any,i:number)=><tr key={i} style={{borderBottom:'1px solid '+COLORS.border+'22'}} onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=COLORS.border+'33';}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent';}}>
                      <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:COLORS.dimmed}}>{s.siteNum}</td>
                      <td style={{padding:'8px 10px',color:COLORS.text,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.siteName}>{s.siteName}</td>
                      <td style={{padding:'8px 10px',color:COLORS.blue,fontWeight:700}}>{formatNumber(s.totalRefs)}</td>
                      <td style={{padding:'8px 10px',color:COLORS.purple,fontWeight:600}}>{s.uniqueTargets}</td>
                      <td style={{padding:'8px 10px',color:COLORS.green,fontWeight:600}}>{s.uniqueUsers}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>}
              {referralSection==='sender'&&<div style={{maxHeight:600,overflowY:'auto',borderRadius:8,border:'1px solid '+COLORS.border+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                    <tr style={{borderBottom:'2px solid '+COLORS.border}}>
                      <th style={{...sortHeaderStyle(referralSortField,'_',COLORS.border),width:30,cursor:'default'}}></th>
                      <th style={sortHeaderStyle(referralSortField,'userName',COLORS.border)} onClick={()=>doRtSort('userName')}>Username{sortIcon(referralSortField,referralSortDir,'userName')}</th>
                      <th style={sortHeaderStyle(referralSortField,'fullName',COLORS.border)} onClick={()=>doRtSort('fullName')}>Full Name{sortIcon(referralSortField,referralSortDir,'fullName')}</th>
                      <th style={sortHeaderStyle(referralSortField,'clinicianType',COLORS.border)} onClick={()=>doRtSort('clinicianType')}>Clinician Type{sortIcon(referralSortField,referralSortDir,'clinicianType')}</th>
                      <th style={sortHeaderStyle(referralSortField,'profId',COLORS.border)} onClick={()=>doRtSort('profId')}>Professional ID{sortIcon(referralSortField,referralSortDir,'profId')}</th>
                      <th style={sortHeaderStyle(referralSortField,'totalRefs',COLORS.border)} onClick={()=>doRtSort('totalRefs')}>Referrals Sent{sortIcon(referralSortField,referralSortDir,'totalRefs')}</th>
                      <th style={sortHeaderStyle(referralSortField,'uniqueTargets',COLORS.border)} onClick={()=>doRtSort('uniqueTargets')}>Target Sites{sortIcon(referralSortField,referralSortDir,'uniqueTargets')}</th>
                      <th style={sortHeaderStyle(referralSortField,'uniqueListings',COLORS.border)} onClick={()=>doRtSort('uniqueListings')}>Target Listings{sortIcon(referralSortField,referralSortDir,'uniqueListings')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(filteredReferralData as any[]).map((s:any,i:number)=>{const rowKey=s.isUnknown?'__unknown__':s.userName;const isExp=referralExpanded===rowKey;return(<>
                      <tr key={'r'+i} style={{borderBottom:s.isUnknown&&!isExp?'2px solid '+COLORS.amber+'44':'1px solid '+COLORS.border+'22',cursor:'pointer',background:isExp?COLORS.border+'44':s.isUnknown?COLORS.amber+'11':'transparent'}} onClick={()=>setReferralExpanded(isExp?null:rowKey)} onMouseEnter={e=>{if(!isExp&&!s.isUnknown)(e.currentTarget as HTMLElement).style.background=COLORS.border+'33';}} onMouseLeave={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background=s.isUnknown?COLORS.amber+'11':'transparent';}}>
                        <td style={{padding:'8px 6px',textAlign:'center',fontSize:14,color:s.isUnknown?COLORS.amber:COLORS.dimmed,transition:'transform 0.2s',transform:isExp?'rotate(90deg)':'rotate(0deg)'}}>&#9656;</td>
                        <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:s.isUnknown?COLORS.amber:COLORS.dimmed,fontStyle:s.isUnknown?'italic':'normal'}}>{s.isUnknown?'—':s.userName}</td>
                        <td style={{padding:'8px 10px',color:s.isUnknown?COLORS.amber:COLORS.text,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontStyle:s.isUnknown?'italic':'normal',fontWeight:s.isUnknown?600:400}} title={s.fullName}>{s.fullName}</td>
                        <td style={{padding:'8px 10px',color:COLORS.muted}}>{s.clinicianType||'—'}</td>
                        <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:s.profId?COLORS.text:COLORS.dimmed,fontStyle:s.profId?'normal':'italic'}}>{s.profId||'—'}</td>
                        <td style={{padding:'8px 10px',color:s.isUnknown?COLORS.amber:COLORS.green,fontWeight:700}}>{formatNumber(s.totalRefs)}</td>
                        <td style={{padding:'8px 10px',color:COLORS.purple,fontWeight:600}}>{s.uniqueTargets}</td>
                        <td style={{padding:'8px 10px',color:COLORS.accent,fontWeight:600}}>{s.uniqueListings}</td>
                      </tr>
                      {isExp&&s.srcSites&&s.srcSites.length>0&&<tr key={'d'+i}><td colSpan={8} style={{padding:0}}>
                        <div style={{background:COLORS.background,borderTop:'1px solid '+COLORS.border,borderBottom:s.isUnknown?'2px solid '+COLORS.amber+'44':'1px solid '+COLORS.border,padding:'12px 20px 12px 46px'}}>
                          <div style={{fontSize:11,color:COLORS.dimmed,fontWeight:700,textTransform:'uppercase',marginBottom:8,letterSpacing:0.5}}>Sending sites for {s.isUnknown?'unknown senders':s.fullName}</div>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                            <thead><tr style={{borderBottom:'1px solid '+COLORS.border}}>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Site Number</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Site Name</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:COLORS.dimmed,fontWeight:600}}>Referrals Sent</th>
                            </tr></thead>
                            <tbody>{s.srcSites.map((ss:any,j:number)=><tr key={j} style={{borderBottom:'1px solid '+COLORS.border+'22'}}>
                              <td style={{padding:'5px 8px',fontFamily:"'JetBrains Mono'",color:COLORS.dimmed}}>{ss.siteNum}</td>
                              <td style={{padding:'5px 8px',color:COLORS.text,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={ss.siteName}>{ss.siteName}</td>
                              <td style={{padding:'5px 8px',color:COLORS.blue,fontWeight:700}}>{formatNumber(ss.count)}</td>
                            </tr>)}</tbody>
                          </table>
                          <div style={{marginTop:8,fontSize:11,color:COLORS.muted}}>{s.isUnknown?'Unknown senders':s.fullName} sent from <strong style={{color:COLORS.text}}>{s.srcSites.length}</strong> site{s.srcSites.length!==1?'s':''} — <strong style={{color:s.isUnknown?COLORS.amber:COLORS.green}}>{formatNumber(s.totalRefs)}</strong> total referrals</div>
                        </div>
                      </td></tr>}
                      {isExp&&(!s.srcSites||s.srcSites.length===0)&&<tr key={'d'+i}><td colSpan={8} style={{padding:0}}>
                        <div style={{background:COLORS.background,borderTop:'1px solid '+COLORS.border,borderBottom:'1px solid '+COLORS.border,padding:'16px 46px',fontSize:12,color:COLORS.dimmed,fontStyle:'italic'}}>No source site information available for these referrals.</div>
                      </td></tr>}
                    </>);})}
                  </tbody>
                </table>
              </div>}
              {filteredReferralData.length===0&&<div style={{textAlign:'center',padding:'32px 0',color:COLORS.dimmed}}>No results match your search.</div>}
            </div>
          </>:<div style={{textAlign:'center',padding:'40px 0',color:COLORS.dimmed}}>{referralsLoaded?'Load Listings, Sites, and Users files alongside Referral Analytics for full cross-referencing.':'Load the Referral Analytics export file to view referral activity.'}</div>}
        </TabsContent>
        <TabsContent value='dataquality'>
          {dataQuality&&<>
            {referralParser.metadata && referralIngestDiag && <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24,marginBottom:20}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:8}}>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,margin:0}}>0. Referral Ingest Quality</h3>
                  <p style={{fontSize:12,color:COLORS.dimmed,margin:'4px 0 0'}}>Ingestion diagnostics from the active referral upload ({referralParser.metadata.parser} parser, {referralParser.metadata.ingestRoute} route).</p>
                </div>
                {referralIngestStatus && <span style={{fontSize:11,fontWeight:700,color:referralIngestStatus.color,background:referralIngestStatus.color+'15',border:'1px solid '+referralIngestStatus.color+'44',padding:'4px 10px',borderRadius:999,textTransform:'uppercase',letterSpacing:0.6}}>{referralIngestStatus.label} · {referralIngestAcceptance}% accepted</span>}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:12,marginBottom:16}}>
                <div style={{background:COLORS.background,border:'1px solid '+COLORS.border,borderRadius:8,padding:12}}><div style={{fontSize:11,color:COLORS.dimmed,textTransform:'uppercase'}}>Source Rows</div><div style={{fontSize:20,fontWeight:800,color:COLORS.text}}>{formatNumber(referralIngestDiag.sourceRows)}</div></div>
                <div style={{background:COLORS.background,border:'1px solid '+COLORS.border,borderRadius:8,padding:12}}><div style={{fontSize:11,color:COLORS.dimmed,textTransform:'uppercase'}}>Accepted</div><div style={{fontSize:20,fontWeight:800,color:COLORS.green}}>{formatNumber(referralIngestDiag.acceptedRows)}</div></div>
                <div style={{background:COLORS.background,border:'1px solid '+COLORS.border,borderRadius:8,padding:12}}><div style={{fontSize:11,color:COLORS.dimmed,textTransform:'uppercase'}}>Omitted</div><div style={{fontSize:20,fontWeight:800,color:COLORS.amber}}>{formatNumber(referralIngestDiag.omittedRows)}</div></div>
                <div style={{background:COLORS.background,border:'1px solid '+COLORS.border,borderRadius:8,padding:12}}><div style={{fontSize:11,color:COLORS.dimmed,textTransform:'uppercase'}}>Mismatch Rows</div><div style={{fontSize:20,fontWeight:800,color:COLORS.red}}>{formatNumber(referralIngestDiag.mismatchedRows)}</div></div>
                <div style={{background:COLORS.background,border:'1px solid '+COLORS.border,borderRadius:8,padding:12}}><div style={{fontSize:11,color:COLORS.dimmed,textTransform:'uppercase'}}>Missing Required</div><div style={{fontSize:20,fontWeight:800,color:COLORS.red}}>{formatNumber(referralIngestDiag.missingRequiredRows)}</div></div>
                <div style={{background:COLORS.background,border:'1px solid '+COLORS.border,borderRadius:8,padding:12}}><div style={{fontSize:11,color:COLORS.dimmed,textTransform:'uppercase'}}>Invalid Date Rows</div><div style={{fontSize:20,fontWeight:800,color:COLORS.purple}}>{formatNumber(referralIngestDiag.invalidDateRows)}</div></div>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10,flexWrap:'wrap',gap:10}}>
                <div style={{fontSize:12,color:COLORS.muted}}>Storage: <span style={{color:COLORS.text,fontWeight:600}}>{referralParser.metadata.storageEngine.toUpperCase()}</span> · Signature: <span style={{color:COLORS.text,fontFamily:"'JetBrains Mono'"}}>{referralParser.metadata.paritySignature || '—'}</span></div>
                <div style={{fontSize:12,color:COLORS.muted}}>File: <span style={{color:COLORS.text}}>{referralParser.metadata.fileName}</span></div>
              </div>
              {!!referralIngestDiag.omittedSamples?.length && <div style={{marginTop:14}}>
                <h4 style={{fontSize:13,fontWeight:700,margin:'0 0 8px'}}>Sample Omitted Rows ({referralIngestDiag.omittedSamples.length})</h4>
                <div style={{maxHeight:260,overflowY:'auto',border:'1px solid '+COLORS.border+'22',borderRadius:8}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                    <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                      <tr style={{borderBottom:'1px solid '+COLORS.border}}>
                        <th style={{padding:'8px',textAlign:'left',color:COLORS.dimmed}}>Reason</th>
                        <th style={{padding:'8px',textAlign:'left',color:COLORS.dimmed}}>Line</th>
                        <th style={{padding:'8px',textAlign:'left',color:COLORS.dimmed}}>Referral Ref</th>
                        <th style={{padding:'8px',textAlign:'left',color:COLORS.dimmed}}>Referral Date</th>
                        <th style={{padding:'8px',textAlign:'left',color:COLORS.dimmed}}>Fields</th>
                        <th style={{padding:'8px',textAlign:'left',color:COLORS.dimmed}}>Raw Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {referralIngestDiag.omittedSamples.map((sample,idx)=><tr key={idx} style={{borderBottom:'1px solid '+COLORS.border+'22'}}>
                        <td style={{padding:'6px 8px',color:sample.reasonCode==='MISSING_REQUIRED'?COLORS.red:COLORS.amber,fontWeight:700}}>{sample.reasonCode}</td>
                        <td style={{padding:'6px 8px',color:COLORS.text,fontFamily:"'JetBrains Mono'"}}>{sample.lineNumber}</td>
                        <td style={{padding:'6px 8px',color:sample.referralRef?COLORS.text:COLORS.dimmed,fontFamily:"'JetBrains Mono'"}}>{sample.referralRef||'—'}</td>
                        <td style={{padding:'6px 8px',color:sample.referralCreationDate?COLORS.text:COLORS.dimmed}}>{sample.referralCreationDate||'—'}</td>
                        <td style={{padding:'6px 8px',color:COLORS.muted,fontFamily:"'JetBrains Mono'"}}>{sample.parsedFieldCount}/{sample.expectedFieldCount}</td>
                        <td style={{padding:'6px 8px',color:COLORS.muted,maxWidth:360,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}} title={sample.rawPreview}>{sample.rawPreview||'—'}</td>
                      </tr>)}
                    </tbody>
                  </table>
                </div>
              </div>}
            </div>}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
              <KPI label='Unmatched User Links' value={dataQuality.coverage.userToSite.linksOrphaned} sub={percentage(dataQuality.coverage.userToSite.linksOrphaned,dataQuality.coverage.userToSite.linksTotal)+'% of all user-site links'} color={COLORS.red}/>
              <KPI label='Orphaned Site Numbers' value={dataQuality.orphanedSNs.length} sub='not in Sites extract' color={COLORS.amber}/>
              <KPI label='Blank Site Users' value={dataQuality.blankUsers.length} sub='no site number assigned' color={COLORS.amber}/>
              <KPI label='Join Health' value={percentage(dataQuality.coverage.userToSite.linksMatched,dataQuality.coverage.userToSite.linksTotal)+'%'} sub={dataQuality.coverage.userToSite.linksMatched+' of '+dataQuality.coverage.userToSite.linksTotal+' links resolve'} color={dataQuality.coverage.userToSite.linksMatched/Math.max(dataQuality.coverage.userToSite.linksTotal,1)>=0.9?COLORS.green:dataQuality.coverage.userToSite.linksMatched/Math.max(dataQuality.coverage.userToSite.linksTotal,1)>=0.7?COLORS.amber:COLORS.red}/>
            </div>

            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24,marginBottom:20}}>
              <h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>1. Cross-File Join Coverage Matrix</h3>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
                <div style={{background:COLORS.background,borderRadius:8,border:'1px solid '+COLORS.border,padding:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:COLORS.accent,marginBottom:12,textTransform:'uppercase',letterSpacing:0.5}}>Users → Sites</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Unique site numbers in Users</span><span style={{color:COLORS.text,fontWeight:600}}>{dataQuality.coverage.userToSite.uniqueSNs}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Matched in Sites file</span><span style={{color:COLORS.green,fontWeight:600}}>{dataQuality.coverage.userToSite.matched}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Not found in Sites</span><span style={{color:COLORS.red,fontWeight:600}}>{dataQuality.coverage.userToSite.orphaned}</span></div>
                    <div style={{height:1,background:COLORS.border,margin:'4px 0'}}/>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>User-site links (total)</span><span style={{color:COLORS.text,fontWeight:600}}>{formatNumber(dataQuality.coverage.userToSite.linksTotal)}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Links resolved</span><span style={{color:COLORS.green,fontWeight:600}}>{formatNumber(dataQuality.coverage.userToSite.linksMatched)}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Links orphaned</span><span style={{color:COLORS.red,fontWeight:600}}>{formatNumber(dataQuality.coverage.userToSite.linksOrphaned)}</span></div>
                    <Progress value={percentage(dataQuality.coverage.userToSite.linksMatched,dataQuality.coverage.userToSite.linksTotal)} style={{height:6,marginTop:4,background:COLORS.border}}/>
                    <div style={{fontSize:11,color:COLORS.dimmed,textAlign:'center'}}>{percentage(dataQuality.coverage.userToSite.linksMatched,dataQuality.coverage.userToSite.linksTotal)}% coverage</div>
                  </div>
                </div>
                <div style={{background:COLORS.background,borderRadius:8,border:'1px solid '+COLORS.border,padding:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:COLORS.purple,marginBottom:12,textTransform:'uppercase',letterSpacing:0.5}}>Listings → Sites</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Unique site numbers in Listings</span><span style={{color:COLORS.text,fontWeight:600}}>{dataQuality.coverage.listingToSite.uniqueSNs}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Matched in Sites file</span><span style={{color:COLORS.green,fontWeight:600}}>{dataQuality.coverage.listingToSite.matched}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Not found in Sites</span><span style={{color:COLORS.red,fontWeight:600}}>{dataQuality.coverage.listingToSite.orphaned}</span></div>
                    <div style={{height:1,background:COLORS.border,margin:'4px 0'}}/>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Listing rows matched</span><span style={{color:COLORS.green,fontWeight:600}}>{formatNumber(dataQuality.coverage.listingToSite.linksMatched)}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>Listing rows orphaned</span><span style={{color:COLORS.red,fontWeight:600}}>{formatNumber(dataQuality.coverage.listingToSite.linksOrphaned)}</span></div>
                    <Progress value={percentage(dataQuality.coverage.listingToSite.linksMatched,dataQuality.coverage.listingToSite.linksMatched+dataQuality.coverage.listingToSite.linksOrphaned)} style={{height:6,marginTop:4,background:COLORS.border}}/>
                    <div style={{fontSize:11,color:COLORS.dimmed,textAlign:'center'}}>{percentage(dataQuality.coverage.listingToSite.linksMatched,dataQuality.coverage.listingToSite.linksMatched+dataQuality.coverage.listingToSite.linksOrphaned)}% coverage</div>
                  </div>
                </div>
                <div style={{background:COLORS.background,borderRadius:8,border:'1px solid '+COLORS.border,padding:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:COLORS.green,marginBottom:12,textTransform:'uppercase',letterSpacing:0.5}}>Users → Listings</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>User site #s also in Listings</span><span style={{color:COLORS.green,fontWeight:600}}>{dataQuality.coverage.userToListing.inListings}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:COLORS.muted}}>User site #s not in Listings</span><span style={{color:COLORS.amber,fontWeight:600}}>{dataQuality.coverage.userToListing.notInListings}</span></div>
                    <div style={{height:1,background:COLORS.border,margin:'4px 0'}}/>
                    <div style={{fontSize:11,color:COLORS.muted,lineHeight:1.5}}>Shows how many unique site numbers from the Users file also appear as a siteNum on at least one listing</div>
                    <Progress value={percentage(dataQuality.coverage.userToListing.inListings,dataQuality.coverage.userToListing.inListings+dataQuality.coverage.userToListing.notInListings)} style={{height:6,marginTop:4,background:COLORS.border}}/>
                    <div style={{fontSize:11,color:COLORS.dimmed,textAlign:'center'}}>{percentage(dataQuality.coverage.userToListing.inListings,dataQuality.coverage.userToListing.inListings+dataQuality.coverage.userToListing.notInListings)}% overlap</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24,marginBottom:20}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,margin:0}}>2. Orphaned Users</h3>
                  <p style={{fontSize:12,color:COLORS.dimmed,margin:'4px 0 0'}}>Users whose site numbers do not appear in the Sites extract ({dataQuality.orphanedUsers.length} fully orphaned, {dataQuality.partialOrphanUsers} partially orphaned)</p>
                </div>
              </div>
              {dataQuality.orphanedUsers.length>0?<div style={{maxHeight:400,overflowY:'auto',borderRadius:8,border:'1px solid '+COLORS.border+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                    <tr style={{borderBottom:'2px solid '+COLORS.border}}>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>User Name</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Clinician Type</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Site Numbers (raw)</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Date of Agreement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataQuality.orphanedUsers.map((u,i)=><tr key={i} style={{borderBottom:'1px solid '+COLORS.border+'22'}}>
                      <td style={{padding:'8px 10px',color:COLORS.text}}>{u.name}</td>
                      <td style={{padding:'8px 10px',color:COLORS.muted}}>{u.clinicianType||'—'}</td>
                      <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:COLORS.red,fontSize:11}}>{u.siteNumbers}</td>
                      <td style={{padding:'8px 10px',color:COLORS.muted}}>{u.dateOfAgreement||'—'}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>:<div style={{textAlign:'center',padding:'24px 0',color:COLORS.green,fontSize:13}}>All users have at least one site number that matches the Sites extract.</div>}
            </div>

            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24,marginBottom:20}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,margin:0}}>3. Orphaned Site Numbers Inventory</h3>
                  <p style={{fontSize:12,color:COLORS.dimmed,margin:'4px 0 0'}}>Site numbers appearing in Users or Listings but not in the Sites extract ({dataQuality.orphanedSNs.length} found)</p>
                </div>
              </div>
              {dataQuality.orphanedSNs.length>0?<div style={{maxHeight:400,overflowY:'auto',borderRadius:8,border:'1px solid '+COLORS.border+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                    <tr style={{borderBottom:'2px solid '+COLORS.border}}>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Site Number</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Users Referencing</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Listings Referencing</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Sample Users</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataQuality.orphanedSNs.map((s,i)=><tr key={i} style={{borderBottom:'1px solid '+COLORS.border+'22'}}>
                      <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:COLORS.amber,fontWeight:600}}>{s.siteNumber}</td>
                      <td style={{padding:'8px 10px',color:s.userCount>0?COLORS.blue:COLORS.dimmed,fontWeight:600}}>{s.userCount}</td>
                      <td style={{padding:'8px 10px',color:s.listingCount>0?COLORS.purple:COLORS.dimmed,fontWeight:600}}>{s.listingCount}</td>
                      <td style={{padding:'8px 10px',color:COLORS.muted,fontSize:11,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.sampleUsers.join(', ')}>{s.sampleUsers.join(', ')||'—'}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>:<div style={{textAlign:'center',padding:'24px 0',color:COLORS.green,fontSize:13}}>All site numbers in Users and Listings exist in the Sites extract.</div>}
            </div>

            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,margin:0}}>4. Users with Blank Site Numbers</h3>
                  <p style={{fontSize:12,color:COLORS.dimmed,margin:'4px 0 0'}}>{dataQuality.blankUsers.length} users have no site number assigned</p>
                </div>
              </div>
              {dataQuality.blankUsers.length>0?<div style={{maxHeight:350,overflowY:'auto',borderRadius:8,border:'1px solid '+COLORS.border+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                    <tr style={{borderBottom:'2px solid '+COLORS.border}}>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>User Name</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Clinician Type</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Email</th>
                      <th style={{padding:'10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Date of Agreement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dataQuality.blankUsers.map((u,i)=><tr key={i} style={{borderBottom:'1px solid '+COLORS.border+'22'}}>
                      <td style={{padding:'8px 10px',color:COLORS.text}}>{u.name}</td>
                      <td style={{padding:'8px 10px',color:COLORS.muted}}>{u.clinicianType||'—'}</td>
                      <td style={{padding:'8px 10px',color:COLORS.muted,fontSize:11}}>{u.email||'—'}</td>
                      <td style={{padding:'8px 10px',color:COLORS.muted}}>{u.dateOfAgreement||'—'}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>:<div style={{textAlign:'center',padding:'24px 0',color:COLORS.green,fontSize:13}}>All users have at least one site number assigned.</div>}
            </div>

            <div style={{background:COLORS.card,borderRadius:12,border:'1px solid '+COLORS.border,padding:24,marginTop:20}}>
              <h3 style={{fontSize:15,fontWeight:700,margin:0,marginBottom:4}}>5. Column Mapping Diagnostic</h3>
              <p style={{fontSize:12,color:COLORS.dimmed,margin:'0 0 16px'}}>Shows each raw column header from the source files and how it was resolved. <span style={{color:COLORS.green,fontWeight:600}}>MAPPED</span> = recognized and used by the dashboard. <span style={{color:COLORS.dimmed,fontWeight:600}}>NOT USED</span> = not referenced in any analytics. <span style={{color:COLORS.red,fontWeight:600}}>UNMAPPED</span> = the dashboard expects this field but the column header didn't match the field map — needs attention.</p>
              {([['Listings',listingHeaders,COLORS.accent,'listing'],['Sites',siteHeaders,COLORS.blue,'site'],['Users',userHeaders,COLORS.purple,'user'],['Referrals',referralHeaders,COLORS.green,'referral']] as [string,typeof listingHeaders,string,string][]).map(([label,headers,color,fileType])=>{
                const usedSet=USED_FIELDS[fileType]||new Set();
                return <div key={label} style={{marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color,marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>{label} ({headers.length} columns)</div>
                  {headers.length>0?<div style={{maxHeight:300,overflowY:'auto',borderRadius:8,border:'1px solid '+COLORS.border+'22'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                      <thead style={{position:'sticky',top:0,zIndex:2,background:COLORS.card}}>
                        <tr style={{borderBottom:'2px solid '+COLORS.border}}>
                          <th style={{padding:'8px 10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Raw Header</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Mapped To</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Status</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Definition</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Sample Value (row 1)</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:COLORS.dimmed,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Raw Chars</th>
                        </tr>
                      </thead>
                      <tbody>
                        {headers.map((h,i)=>{const status=h.inMap?'MAPPED':usedSet.has(h.mapped)?'UNMAPPED':'NOT USED';const stColor=status==='MAPPED'?COLORS.green:status==='UNMAPPED'?COLORS.red:COLORS.dimmed;return(<tr key={i} style={{borderBottom:'1px solid '+COLORS.border+'22',background:status==='UNMAPPED'?COLORS.red+'11':'transparent'}}>
                          <td style={{padding:'6px 10px',fontFamily:"'JetBrains Mono'",color:COLORS.text,fontSize:11}}>{h.raw}</td>
                          <td style={{padding:'6px 10px',fontFamily:"'JetBrains Mono'",color:stColor,fontSize:11}}>{h.mapped}</td>
                          <td style={{padding:'6px 10px'}}><span style={{padding:'2px 6px',borderRadius:4,fontSize:9,fontWeight:600,background:stColor+'22',color:stColor}}>{status}</span></td>
                          <td style={{padding:'6px 10px',color:COLORS.muted,fontSize:11,maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:FIELD_DEFS[h.raw]?'help':'default'}} title={FIELD_DEFS[h.raw]||''}>{FIELD_DEFS[h.raw]?(FIELD_DEFS[h.raw].length>60?FIELD_DEFS[h.raw].substring(0,60)+'…':FIELD_DEFS[h.raw]):'—'}</td>
                          <td style={{padding:'6px 10px',color:COLORS.muted,fontSize:11,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={h.sample}>{h.sample||'—'}</td>
                          <td style={{padding:'6px 10px',fontFamily:"'JetBrains Mono'",color:COLORS.dimmed,fontSize:9}}>{Array.from(h.raw).map(c=>c.charCodeAt(0)).join(' ')}</td>
                        </tr>);})}
                      </tbody>
                    </table>
                  </div>:<div style={{fontSize:12,color:COLORS.dimmed}}>No headers loaded yet.</div>}
                </div>;}
              )}
            </div>
          </>}
          {!dataQuality&&<div style={{textAlign:'center',padding:'40px 0',color:COLORS.dimmed}}>Load all three files (Listings, Sites, Users) to run data quality checks.</div>}
        </TabsContent>
      </Tabs>}
      {!anyLoaded&&<div style={{textAlign:'center',padding:'60px 0',color:COLORS.dimmed}}><div style={{fontSize:48,marginBottom:16,opacity:0.3}}>📊</div><p style={{fontSize:14}}>Upload your Regional Authority export files above to view adoption analytics</p></div>}
    </div>
  </div>;
}
