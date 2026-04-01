import { useState, useMemo, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

import * as XLSX from 'xlsx';

const LISTING_MAP: Record<string,string> = {ref:'ref',title:'title',city:'city',province:'province',postalcode:'postalCode',postalCode:'postalCode',healthregion:'healthRegion',healthRegion:'healthRegion',ereferrals:'eReferrals',eReferrals:'eReferrals',econsults:'eConsults',eConsults:'eConsults',ccenabled:'CCEnabled',CCEnabled:'CCEnabled',ccsek:'CCSEK',CCSEK:'CCSEK',listingrepositorycontribution:'listingRepositoryContribution',listingRepositoryContribution:'listingRepositoryContribution',trusteecustodian:'trusteeCustodian',trusteeCustodian:'trusteeCustodian','ra approval status':'raApprovalStatus','RA Approval Status':'raApprovalStatus','test mode':'testMode','Test Mode':'testMode',sitenum:'siteNum',siteNum:'siteNum',sitename:'siteName',siteName:'siteName',listingtype:'listingType',listingType:'listingType','ereferral management':'eReferralManagement','eReferral management':'eReferralManagement',catchmentarea:'catchmentArea',catchmentArea:'catchmentArea',raclinicianscount:'raCliniciansCount',raCliniciansCount:'raCliniciansCount',organizationtitle:'organizationTitle',organizationTitle:'organizationTitle',integratedsystem:'integratedSystem',integratedSystem:'integratedSystem',services:'services',language:'language',claimedbyuser:'claimedByUser',claimedByUser:'claimedByUser','claimed by user':'claimedByUser','Claimed By User':'claimedByUser',clinicianprofessionalid:'clinicianProfessionalId',clinicianProfessionalId:'clinicianProfessionalId','clinician Professional ID':'clinicianProfessionalId','clinician professional id':'clinicianProfessionalId'};
const SITE_MAP: Record<string,string> = {'site number':'siteNumber','Site Number':'siteNumber','site name':'siteName','Site Name':'siteName','# of approved listings':'approvedListings','# of Approved Listings':'approvedListings','patient messaging coverage enabled':'patientMessagingEnabled','Patient Messaging Coverage Enabled':'patientMessagingEnabled','# of patient messaging licences':'patientMessagingLicences','# of Patient Messaging Licences':'patientMessagingLicences','online booking coverage enabled':'onlineBookingEnabled','Online Booking Coverage Enabled':'onlineBookingEnabled','# of online booking licences':'onlineBookingLicences','# of Online Booking Licences':'onlineBookingLicences','estimated total licence fees per month ($)':'estimatedFees','Estimated Total Licence Fees per Month ($)':'estimatedFees',emr:'emr',EMR:'emr','organization address':'organizationAddress','Organization Address':'organizationAddress','validated site':'validatedSite','Validated Site':'validatedSite','site validation status changed by':'validationChangedBy','Site Validation Status Changed By':'validationChangedBy','site validation status changed on':'validationChangedOn','Site Validation Status Changed On':'validationChangedOn'};
const USER_MAP: Record<string,string> = {username:'userName',UserName:'userName',name:'name',Name:'name',cliniciantype:'clinicianType',ClinicianType:'clinicianType',phone:'phone',Phone:'phone','professional id':'professionalId','Professional ID':'professionalId',email:'email',Email:'email','site names':'siteNames','Site Names':'siteNames','site numbers':'siteNumbers','Site Numbers':'siteNumbers',dateofagreement:'dateOfAgreement',DateOfAgreement:'dateOfAgreement',licenseversion:'licenseVersion',LicenseVersion:'licenseVersion','hinp agreement signatory':'hinpSignatory','HINP Agreement Signatory':'hinpSignatory',valid:'valid',Valid:'valid'};
const REFERRAL_MAP: Record<string,string> = {sitenum:'siteNum',siteNum:'siteNum',srcsitenum:'srcsiteNum',srcsiteNum:'srcsiteNum',srcSiteName:'srcSiteName',srcsitename:'srcSiteName',referraltargetref:'referralTargetRef',referralTargetRef:'referralTargetRef',referredbyusername:'referredByUserName',referredByUserName:'referredByUserName',referredbyuserfullname:'referredByUserFullName',referredByUserFullName:'referredByUserFullName',referralcreationdate:'referralCreationDate',referralCreationDate:'referralCreationDate',referralstate:'referralState',referralState:'referralState',referralref:'referralRef',referralRef:'referralRef',recipientname:'recipientName',recipientName:'recipientName',referralsource:'referralSource',referralSource:'referralSource',senttotestlisting:'sentToTestListing',sentToTestListing:'sentToTestListing',completionstate:'completionState',completionState:'completionState',referrercliniciantype:'referrerClinicianType',referrerClinicianType:'referrerClinicianType',referrername:'referrerName',referrerName:'referrerName',accepteddate:'acceptedDate',acceptedDate:'acceptedDate',completeddate:'completedDate',completedDate:'completedDate',inbound:'inbound',econsultoutcome:'eConsultOutcome',eConsultOutcome:'eConsultOutcome',initialrecipientname:'initialRecipientName',initialRecipientName:'initialRecipientName',initialreferraltargetref:'initialReferralTargetRef',initialReferralTargetRef:'initialReferralTargetRef',referrerurgency:'referrerUrgency',referrerUrgency:'referrerUrgency',recipientpriority:'recipientPriority',recipientPriority:'recipientPriority',patientcity:'patientCity',patientCity:'patientCity',patientprovince:'patientProvince',patientProvince:'patientProvince',referrercity:'referrerCity',referrerCity:'referrerCity',referrerprovince:'referrerProvince',referrerProvince:'referrerProvince',recipientprovince:'recipientProvince',recipientProvince:'recipientProvince',referrerprofessionalid:'referrerProfessionalId',referrerProfessionalId:'referrerProfessionalId',currenthealthservice:'currentHealthService',currentHealthService:'currentHealthService',initialhealthservice:'initialHealthService',initialHealthService:'initialHealthService',externalserviceid:'externalServiceId',externalServiceId:'externalServiceId'};
const USED_FIELDS:Record<string,Set<string>> = {
  listing: new Set(['ref','title','city','province','postalCode','healthRegion','eReferrals','eConsults','CCEnabled','CCSEK','listingRepositoryContribution','trusteeCustodian','raApprovalStatus','testMode','siteNum','siteName','listingType','eReferralManagement','catchmentArea','raCliniciansCount','organizationTitle','integratedSystem','services','language','claimedByUser','clinicianProfessionalId']),
  site: new Set(['siteNumber','siteName','approvedListings','patientMessagingEnabled','patientMessagingLicences','onlineBookingEnabled','onlineBookingLicences','estimatedFees','emr','organizationAddress','validatedSite','validationChangedBy','validationChangedOn']),
  user: new Set(['userName','name','clinicianType','phone','professionalId','email','siteNames','siteNumbers','dateOfAgreement','licenseVersion','hinpSignatory','valid']),
  referral: new Set(['siteNum','srcsiteNum','srcSiteName','referralTargetRef','referredByUserName','referredByUserFullName','referralCreationDate','referralState','referralRef','recipientName','referralSource','sentToTestListing','completionState','referrerClinicianType','referrerName','acceptedDate','completedDate','inbound','eConsultOutcome','initialRecipientName','initialReferralTargetRef','referrerUrgency','recipientPriority','patientCity','patientProvince','referrerCity','referrerProvince','recipientProvince','referrerProfessionalId','currentHealthService','initialHealthService','externalServiceId'])
};
const FIELD_DEFS:Record<string,string>={'ref':'Reference name/id for the listing.','title':'The title of the listing.','serviceDescription':'A free-text description of the services offered by the listing. This will typically show up in the healthmap as a description for the listing.','services':'Services offered by the listing. These are pre-defined constants which indicate the services offered.  Healthservice constants, description, synonyms, loinc and snomed codes have been provided which indicate the appropriate healthservice constant to select.','line1':'Street address of the listing','line2':'Apt/unit number of the listing, if applicable','city':'City address of the listing','province':'Province address of the listing','postalCode':'Postal code of the listing','phone':'Phone number of listing','fax':'Fax number of listing','email':'email address of listing','website':'Website of listing','notificationEmail':'The listing\'s eRequest Notification Email','claimedByUser':'Indicates which user claimed the directory listing','clinicianSurname':'Surname of clinician assigned to listing','clinicianFirstName':'First name of clinician assigned to listing','clinicianProfessionalId':'Clinician\'s professional ID','organizationTitle':'Organizations are set up by Ocean site and can be assigned to multiple listings which will enable senders see which listings might be related to which organizations','organizationRef':'Organization reference ID – organizations are set up by site','integratedSystem':'Indicates which external system the listing is integrated with','geocode failure reason':'If listing\'s geocode fails, this field highlights the reason for failure','eReferral management':'Identifies how the eReferrals are managed for the directory listing in Ocean','listingRepositoryContribution':'Reflects the status of the directory listings contribution to the repository: \'CONTRIBUTING\' indicates that all of the following 5 requirements have been met: 1) the ‘Contribute data to repository’ setting within the Directory’s Listing’s settings is enabled, 2) the ‘Enable Ocean Cloud Connect’ checkbox is enabled within the Ocean Site, 3) SEK entered in CC, 4) Site level contributing setting is enabled under “Manage Site Agreement”, and 5) RA site has selected a repository other than “None”. \'NOT_CONTRIBUTING\' indicates that any one of requirements 1-4 in the bullet above has not been met. \'{blank}\' indicates that the Regional Authority has not set a repository (under RA Site > Admin > Regional Authority). If the repository is "None", this column will always be blank.','trusteeCustodian':'Indicates if and how the Ocean Site has identified themselves as a Trustee/Custodian within their Ocean Site configuration. \'TRUSTEE_CUSTODIAN\' indicates that the Ocean Site has identified themselves as a Trustee/Custodidan by selecting the \'Yes, this site is a Trustee/Custodian\' option. \'NON_TRUSTEE_CUSTODIAN\' indicates that the Ocean Site has identified themselves as not being a Health Information Custodian by selecting the \'No, this site is not a Trustee/Custodian\' option. \'UNSPECIFIED\' indicates that the Directory Listing is currently accepting eReferrals, but the Ocean Site has not indicated whether or not they are a Health Information Custodian. \'NOT_ACCEPTING_EREFERRALS\' indicates that the Directory Listing is not accepting eReferrals, regardless of Trustee/Custodian status.','siteNum':'Site number in Ocean that listing is associated with','siteName':'Site name in Ocean that listing is associated with','healthRegion':'Health regions that a site belongs to pertaining to a Regional Authority, may not be applicable to listings outside of British Columbia','listingType':'Defines the type of listing (e.g. STANDARD_CLINICAL_LISTING, RAPID_ACCESS_CLINIC, CENTRAL_INTAKE, REPOSITORY_FOR_REQUISITIONS)','catchmentArea':'Indicating if a catchment area is set for the listing or not','eReferrals':'Indicates \'ENABLED\' if at least one HSO on the listing has \'Accept eReferrals\' set to ‘Yes’ and the listing is actively accepting eRequests (i.e., \'Accepting eRequests\' within the Directory Listing is enabled). Indicates \'NOT ENABLED\' otherwise.','eConsults':'Indicates \'ENABLED\' if at least one HSO on the listing has \'Accept eConsults\' set to ‘Yes’ and the listing is actively accepting eRequests (i.e., \'Accepting eRequests\' within the Directory Listing is enabled). Indicates \'NOT ENABLED\' otherwise.','externalId':'This field populates the value from the Enablement > Integrations > External service ID setting in the listing','language':'Includes the languages supported by the directory listing','raCliniciansCount':'For listings that have applied to a Regional Authority, this field indicates the numbers of clinicians authorized to receive eReferrals and/or eConsults at this directory listing','raCliniciansComment':'For listings that have applied to a Regional Authority, this field shows any additional information associated with the number of clinicians during the application','raCliniciansLastUpdated':'For listings that have applied to a Regional Authority, this field indicates when the number of clinicians was last updated','managesWaitTimesAndIsCI':'For listings that are configured as a Central Intake, this field indicates if the "Managed by Central Intake" wait time management functionality has been enabled (TRUE = enabled).','RA Approval Status':'The approval status of the listing. Can be one of: Pending, Approved, [blank].','Test Mode':'Indicates if Test Mode is enabled on the listing or not (TRUE = enabled)','regionalAuthoritySiteNum':'The Ocean Site number for the Regional Authority Site that the listing has applied to and/or been approved under.','CCEnabled':'Indicates if Ocean Cloud Connect is enabled or disabled for the Ocean Site, where "CC_ENABLED" = Yes and "CC_NOT_ENABLED" = No.','CCSEK':'Indicates if the Ocean Site\'s Shared Encryption Key is stored in Ocean Cloud Connect, where "SEK_STORED" = Yes and "SEK_NOT_STORED" = No.','integrationName':'Name of the integration associated with the Directory Listing (if configured).','billingNum':'Billing number of the clinician assigned to the listing','protectedDescriptionForClinicians':'Information entered in the "Additional information for clinicians" setting of the Directory Listing.','Site Number':'The Ocean Site number.','Site Name':'The name of the Ocean Site.','# of Approved Listings':'The number of Directory Listings that have been approved by the Regional Authority.','Patient Messaging Coverage Enabled':'Indicates whether or not Patient Messaging licence coverage has been enabled by the Regional Authority, where TRUE represents enabled.','# of Patient Messaging Licences':'The number of Patient Messaging licences that have been enabled within the Ocean Site.','Online Booking Coverage Enabled':'Indicates whether or not Online Booking licence coverage has been enabled by the Regional Authority, where TRUE represents enabled.','# of Online Booking Licences':'The number of Online Booking licenses that have been enabled within the Ocean Site.','Estimated Total Licence Fees per Month ($)':'The estimated sum of licence fees per month in dollars that the Regional Authority has assumed responsibility for.','EMR':'The EMR that the Ocean Site is integrated with, if any.','Organization Address':'The concatenated address information as set within the "Menu > Admin > Organization" fields of the Ocean Site.','Validated Site':'Indicates whether or not the "Validate this site" checkbox has been enabled for the Ocean Site within the Manage Site Agreement page.','Site Validation Status Changed By':'The Ocean username of the user that modified the "Validate this site" for the Ocean Site within the Manage Site Agreement page.','Site Validation Status Changed On':'The date that the "Validate this site" for the Ocean Site within the Manage Site Agreement page.','UserName':'The Ocean account username.','Name':'The full name of the user.','ClinicianType':'The User Role as set within the Ocean user account.','Phone':'The phone number associated with the manually entered Clinic Location within the Ocean user account.','Professional ID':'The Professional ID as set within the Ocean user account.','Email':'The email address associated with the Ocean user account.','Site Names':'A list of the name(s) of each of the Ocean Site(s) that the user is associated with, separated by a semi-colon.','Site Numbers':'A list of the Ocean Site Number(s) of each the Ocean Site(s) that the user is associated with, separated by a semi-colon.','DateOfAgreement':'The date the user agreed to the Regional Authority\'s License Agreement.','LicenseVersion':'The version of the License Agreement that the user agreed to.','HINP Agreement Signatory':'The Health Information Network Provider Agreement Signatory (Ontario-specific). This is a deprecated value.','Valid':'The current validity of the agreement, where TRUE represents valid.'};

type ParseResult = { rows: Record<string,string>[]; headerDiag: {raw:string;mapped:string;inMap:boolean;sample:string}[] };
function parseFile(buf: ArrayBuffer, map: Record<string,string>): ParseResult {
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: Record<string,any>[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const headerDiag:{raw:string;mapped:string;inMap:boolean;sample:string}[]=[];
  if(raw.length>0){
    for(const k of Object.keys(raw[0])){
      const inMap=!!(map[k]||map[k.toLowerCase()]);
      const mk=map[k]||map[k.toLowerCase()]||k;
      const sv=raw[0][k];
      const svd=typeof sv==='boolean'?(sv?'TRUE':'FALSE'):String(sv??'').trim();
      const svn=(svd==='true'||svd==='false')?svd.toUpperCase():svd;
      headerDiag.push({raw:k,mapped:mk,inMap,sample:svn.substring(0,60)});
    }
  }
  const rows=raw.map((row: any) => {
    const m: Record<string,string> = {};
    for (const [k, v] of Object.entries(row)) {
      const sv = typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v ?? '').trim();
      m[map[k] || map[k.toLowerCase()] || k] = (sv === 'true' || sv === 'false') ? sv.toUpperCase() : sv;
    }
    return m;
  });
  return {rows,headerDiag};
}

function doExport(data: any[], fn: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Site Maturity');
  XLSX.writeFile(wb, fn);
}

const P = (n: number, d: number) => d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
const F = (n: number) => n.toLocaleString();
const normSN = (s: string) => { const t = (s||'').trim().replace(/\.0+$/, ''); const n = parseInt(t, 10); return isNaN(n) ? t : String(n); };
const fmtDate = (v: string) => { if(!v) return ''; if(/^\d{4}-\d{2}/.test(v)) return v; const n=parseFloat(v); if(!isNaN(n)&&n>1&&n<200000){const d=new Date(Math.round((n-25569)*86400*1000));if(!isNaN(d.getTime())) return d.toISOString().slice(0,10);} return v; };
const clr = {bg:'#0B1120',cd:'#111827',bd:'#1E293B',tx:'#E2E8F0',mu:'#94A3B8',dm:'#64748B',ac:'#22D3EE',gn:'#34D399',gd:'#065F46',gg:'rgba(52,211,153,0.15)',am:'#FBBF24',rd:'#F87171',pu:'#A78BFA',bl:'#60A5FA',ag:'rgba(34,211,238,0.12)'};

function MiniBar({data,height=140,color=clr.ac,stacked}:{data:{label:string;primary:number;secondary?:number}[];height?:number;color?:string;stacked?:boolean}) {
  const [hov,setHov]=useState<number|null>(null);
  const mx=Math.max(...data.map(d=>d.primary+(d.secondary||0)),1);
  const lStep=Math.max(1,Math.floor(data.length/6));
  return <div style={{display:'flex',flexDirection:'column'}}>
    <div style={{display:'flex',alignItems:'flex-end',gap:1,height,position:'relative'}} onMouseLeave={()=>setHov(null)}>
      {data.map((d,i)=>{const tot=d.primary+(d.secondary||0);return<div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',height:'100%',justifyContent:'flex-end',cursor:'default',opacity:hov!==null&&hov!==i?0.4:1,transition:'opacity 0.15s'}} onMouseEnter={()=>setHov(i)}>
        {hov===i&&<span style={{fontSize:8,color:clr.tx,marginBottom:1,fontWeight:700}}>{F(tot)}</span>}
        <div style={{width:'100%',borderRadius:'2px 2px 0 0',height:Math.max((d.primary/mx)*100,0.5)+'%',background:color}}/>
        {stacked&&(d.secondary||0)>0&&<div style={{width:'100%',height:Math.max(((d.secondary||0)/mx)*100,0.5)+'%',background:clr.am}}/>}
      </div>;})}
      {hov!==null&&hov>=0&&hov<data.length&&<div style={{position:'absolute',top:-6,left:'50%',transform:'translateX(-50%)',background:clr.cd,border:'1px solid '+clr.bd,borderRadius:6,padding:'3px 10px',fontSize:10,color:clr.tx,fontWeight:600,whiteSpace:'nowrap',zIndex:5,pointerEvents:'none'}}>
        {data[hov].label} — {F(data[hov].primary+(data[hov].secondary||0))}{stacked&&data[hov].secondary?' ('+F(data[hov].secondary||0)+' test)':''}
      </div>}
    </div>
    <div style={{display:'flex',gap:1,marginTop:4}}>
      {data.map((d,i)=><div key={i} style={{flex:1,textAlign:'center'}}>{(hov===i||i%lStep===0)?<span style={{fontSize:7,color:hov===i?clr.tx:clr.dm,whiteSpace:'nowrap',fontWeight:hov===i?600:400}}>{d.label.substring(5)}</span>:null}</div>)}
    </div>
  </div>;
}

function Bar({data,height=220,color=clr.ac}:{data:{label:string;value:number}[];height?:number;color?:string}) {
  const [hov,setHov]=useState<number|null>(null);
  const mx = Math.max(...data.map(d=>d.value),1);
  const lStep=data.length>16?Math.ceil(data.length/8):data.length>10?2:1;
  const vStep=data.length>20?Math.ceil(data.length/10):data.length>12?2:1;
  return <div style={{display:'flex',alignItems:'flex-end',gap:data.length>16?2:6,height,padding:'8px 0',position:'relative'}} onMouseLeave={()=>setHov(null)}>
    {data.map((d,i)=><div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',height:'100%',justifyContent:'flex-end',cursor:'default'}} onMouseEnter={()=>setHov(i)}>
      {(hov===i||i%vStep===0)&&<span style={{fontSize:hov===i?10:(data.length>16?9:11),color:hov===i?color:clr.tx,marginBottom:2,fontWeight:hov===i?700:600}}>{d.value>0?d.value:''}</span>}
      <div style={{width:'100%',maxWidth:48,borderRadius:'4px 4px 0 0',height:Math.max((d.value/mx)*100,2)+'%',background:hov===i?color:'linear-gradient(180deg,'+color+','+color+'88)',opacity:hov!==null&&hov!==i?0.5:1,transition:'opacity 0.15s'}}/>
      {(hov===i||i%lStep===0)?<span style={{fontSize:data.length>16?8:10,color:hov===i?clr.tx:clr.dm,marginTop:4,textAlign:'center',lineHeight:1.2,maxWidth:60,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:hov===i?600:400}}>{d.label}</span>:<span style={{marginTop:4,fontSize:1}}>&nbsp;</span>}
    </div>)}
  </div>;
}

function Donut({segments,size=160}:{segments:{label:string;value:number;color:string}[];size?:number}) {
  const [hov,setHov]=useState<number|null>(null);
  const total = segments.reduce((s,d)=>s+d.value,0);
  if(total===0) return null;
  const r=size/2-8, cx=size/2, cy=size/2;
  let ca=-90;
  const arcs = segments.filter(s=>s.value>0).map(s=>{
    const ang=(s.value/total)*360;
    const sr=(ca*Math.PI)/180, er=((ca+ang)*Math.PI)/180;
    const x1=cx+r*Math.cos(sr), y1=cy+r*Math.sin(sr);
    const x2=cx+r*Math.cos(er), y2=cy+r*Math.sin(er);
    ca+=ang;
    return {...s,d:'M '+x1+' '+y1+' A '+r+' '+r+' 0 '+(+(ang>180))+' 1 '+x2+' '+y2,pct:P(s.value,total)};
  });
  const ha=hov!==null&&hov>=0&&hov<arcs.length?arcs[hov]:null;
  return <div style={{display:'flex',alignItems:'center',gap:20}}>
    <svg width={size} height={size} onMouseLeave={()=>setHov(null)}>
      {arcs.map((a,i)=><path key={i} d={a.d} fill='none' stroke={a.color} strokeWidth={hov===i?30:24} style={{opacity:hov!==null&&hov!==i?0.3:1,transition:'stroke-width 0.15s,opacity 0.15s',cursor:'pointer'}} onMouseEnter={()=>setHov(i)}/>)}
      <text x={cx} y={cy-6} textAnchor='middle' fill={ha?ha.color:clr.tx} fontSize={ha?20:22} fontWeight={700}>{ha?F(ha.value):F(total)}</text>
      <text x={cx} y={cy+14} textAnchor='middle' fill={clr.dm} fontSize={11}>{ha?ha.pct+'%':'total'}</text>
    </svg>
    <div style={{display:'flex',flexDirection:'column',gap:6}} onMouseLeave={()=>setHov(null)}>
      {arcs.map((a,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer',opacity:hov!==null&&hov!==i?0.4:1,transition:'opacity 0.15s'}} onMouseEnter={()=>setHov(i)}>
        <div style={{width:10,height:10,borderRadius:2,background:a.color,flexShrink:0}}/>
        <span style={{color:hov===i?clr.tx:clr.mu,fontWeight:hov===i?600:400,transition:'color 0.15s'}}>{a.label}</span>
        <span style={{color:clr.tx,fontWeight:600,marginLeft:'auto',whiteSpace:'nowrap'}}>{hov===i?F(a.value)+' ('+a.pct+'%)':a.pct+'%'}</span>
      </div>)}
    </div>
  </div>;
}

function Area({data,height=200,color=clr.ac}:{data:{label:string;value:number;cumulative:number}[];height?:number;color?:string}) {
  const [hov,setHov]=useState<number|null>(null);
  if(!data.length) return null;
  const mv=Math.max(...data.map(d=>d.cumulative),1);
  const W=700,H=height,L=50,R=20,T=20,B=40,pW=W-L-R,pH=H-T-B;
  const pts=data.map((d,i)=>({x:L+(i/Math.max(data.length-1,1))*pW,y:T+pH-(d.cumulative/mv)*pH,...d}));
  const lp=pts.map((p,i)=>(i===0?'M':'L')+' '+p.x+' '+p.y).join(' ');
  const ap=lp+' L '+pts[pts.length-1].x+' '+(T+pH)+' L '+pts[0].x+' '+(T+pH)+' Z';
  const gl=[0,.25,.5,.75,1].map(f=>({y:T+pH-f*pH,label:Math.round(f*mv)}));
  const ls2=Math.max(1,Math.floor(data.length/12));
  const hp=hov!==null&&hov>=0&&hov<pts.length?pts[hov]:null;
  return <svg viewBox={'0 0 '+W+' '+H} style={{width:'100%',height}} onMouseLeave={()=>setHov(null)}>
    <defs><linearGradient id='aG' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stopColor={color} stopOpacity={0.25}/><stop offset='100%' stopColor={color} stopOpacity={0.02}/></linearGradient></defs>
    {gl.map((g,i)=><g key={i}><line x1={L} y1={g.y} x2={W-R} y2={g.y} stroke={clr.bd} strokeWidth={1}/><text x={L-8} y={g.y+4} textAnchor='end' fill={clr.dm} fontSize={10}>{g.label}</text></g>)}
    <path d={ap} fill='url(#aG)'/><path d={lp} fill='none' stroke={color} strokeWidth={2}/>
    {pts.map((p,i)=>i%ls2===0?<text key={'l'+i} x={p.x} y={T+pH+20} textAnchor='middle' fill={clr.dm} fontSize={9}>{p.label}</text>:null)}
    {pts.map((p,i)=><rect key={'h'+i} x={p.x-(pW/data.length)/2} y={T} width={pW/data.length} height={pH} fill='transparent' style={{cursor:'crosshair'}} onMouseEnter={()=>setHov(i)}/>)}
    {hp&&<>
      <line x1={hp.x} y1={T} x2={hp.x} y2={T+pH} stroke={clr.mu} strokeWidth={1} strokeDasharray='4 3' opacity={0.5}/>
      <circle cx={hp.x} cy={hp.y} r={4} fill={color} stroke='#fff' strokeWidth={2}/>
      <rect x={Math.min(hp.x-55,W-R-110)} y={Math.max(hp.y-44,T)} width={110} height={38} rx={6} fill={clr.cd} stroke={clr.bd} strokeWidth={1}/>
      <text x={Math.min(hp.x-55,W-R-110)+55} y={Math.max(hp.y-44,T)+16} textAnchor='middle' fill={clr.tx} fontSize={12} fontWeight={700}>{F(hp.cumulative)}</text>
      <text x={Math.min(hp.x-55,W-R-110)+55} y={Math.max(hp.y-44,T)+30} textAnchor='middle' fill={clr.dm} fontSize={10}>{hp.label} (+{F(hp.value)})</text>
    </>}
  </svg>;
}

function Funnel({steps}:{steps:{label:string;value:number;color:string}[]}) {
  const mx=Math.max(...steps.map(s=>s.value),1);
  return <div style={{display:'flex',flexDirection:'column',gap:8}}>
    {steps.map((s,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:12}}>
      <div style={{width:150,fontSize:12,color:clr.mu,textAlign:'right',flexShrink:0}}>{s.label}</div>
      <div style={{flex:1,height:28,background:clr.bd,borderRadius:4,overflow:'hidden',position:'relative'}}>
        <div style={{height:'100%',width:(s.value/mx)*100+'%',borderRadius:4,background:'linear-gradient(90deg,'+s.color+'cc,'+s.color+')'}}/>
        <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',fontSize:12,fontWeight:700,color:'#fff'}}>{F(s.value)} {i>0?'('+P(s.value,steps[0].value)+'%)':''}</span>
      </div>
    </div>)}
  </div>;
}

function Geo({data}:{data:{region:string;total:number;enabled:number;rate:number}[]}) {
  const sorted=[...data].sort((a,b)=>b.total-a.total);
  const mt=Math.max(...sorted.map(d=>d.total),1);
  return <div style={{display:'flex',flexDirection:'column',gap:4}}>
    <div style={{display:'flex',alignItems:'center',gap:10,padding:'4px 0',marginBottom:4}}>
      <div style={{width:160,fontSize:10,color:clr.dm,fontWeight:700,textTransform:'uppercase'}}>Region</div>
      <div style={{flex:1,fontSize:10,color:clr.dm}}>Distribution</div>
      <div style={{width:50,fontSize:10,color:clr.dm,textAlign:'right',fontWeight:700}}>Total</div>
      <div style={{width:50,fontSize:10,color:clr.dm,textAlign:'right',fontWeight:700}}>eRef</div>
      <div style={{width:50,fontSize:10,color:clr.dm,textAlign:'right',fontWeight:700}}>Rate</div>
    </div>
    {sorted.map((d,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'6px 0'}}>
      <div style={{width:160,fontSize:12,color:clr.tx,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flexShrink:0}}>{d.region||'Unspecified'}</div>
      <div style={{flex:1,height:20,background:clr.bd,borderRadius:3,overflow:'hidden',position:'relative'}}>
        <div style={{height:'100%',width:(d.total/mt)*100+'%',background:clr.ac+'44',borderRadius:3}}/>
        <div style={{position:'absolute',top:0,left:0,height:'100%',width:(d.enabled/mt)*100+'%',background:clr.gn,borderRadius:3,opacity:0.8}}/>
      </div>
      <div style={{width:50,fontSize:12,color:clr.tx,textAlign:'right',fontWeight:600}}>{d.total}</div>
      <div style={{width:50,fontSize:12,color:clr.gn,textAlign:'right',fontWeight:600}}>{d.enabled}</div>
      <div style={{width:50,fontSize:12,textAlign:'right',fontWeight:700,color:d.rate>=70?clr.gn:d.rate>=40?clr.am:clr.rd}}>{d.rate}%</div>
    </div>)}
  </div>;
}

function KPI({label,value,sub,color=clr.ac,icon}:{label:string;value:string|number;sub?:string;color?:string;icon?:string}) {
  return <div style={{background:clr.cd,border:'1px solid '+clr.bd,borderRadius:10,padding:'18px 20px',display:'flex',flexDirection:'column',gap:4,position:'relative',overflow:'hidden'}}>
    {icon&&<div style={{position:'absolute',top:-20,right:-10,fontSize:64,opacity:0.06,color}}>{icon}</div>}
    <span style={{fontSize:11,color:clr.dm,letterSpacing:0.5,textTransform:'uppercase',fontWeight:600}}>{label}</span>
    <span style={{fontSize:28,fontWeight:800,color,lineHeight:1.1}}>{typeof value==='number'?F(value):value}</span>
    {sub&&<span style={{fontSize:12,color:clr.mu}}>{sub}</span>}
  </div>;
}

function Upload({label,desc,loaded,onLoad}:{label:string;desc:string;loaded:boolean;onLoad:(buf:ArrayBuffer)=>void}) {
  const [drag,setDrag]=useState(false);
  const go=useCallback((file:File)=>{
    const r=new FileReader();
    r.onload=(e)=>{if(e.target?.result) onLoad(e.target.result as ArrayBuffer);};
    r.readAsArrayBuffer(file);
  },[onLoad]);
  return <div
    onDragOver={(e)=>{e.preventDefault();setDrag(true);}}
    onDragLeave={()=>setDrag(false)}
    onDrop={(e)=>{e.preventDefault();setDrag(false);if(e.dataTransfer.files[0]) go(e.dataTransfer.files[0]);}}
    onClick={()=>{const inp=document.createElement('input');inp.type='file';inp.accept='.xlsx,.xls,.csv';inp.onchange=()=>{if(inp.files?.[0]) go(inp.files[0]);};inp.click();}}
    style={{background:loaded?clr.gg:drag?clr.ag:clr.cd,border:'2px dashed '+(loaded?clr.gn:drag?clr.ac:clr.bd),borderRadius:10,padding:'20px 16px',cursor:'pointer',display:'flex',flexDirection:'column',alignItems:'center',gap:6}}>
    <span style={{fontSize:28}}>{loaded?'\u2713':'\uD83D\uDCC4'}</span>
    <span style={{fontSize:14,fontWeight:700,color:loaded?clr.gn:clr.tx}}>{label}</span>
    <span style={{fontSize:11,color:clr.dm,textAlign:'center'}}>{loaded?'Loaded successfully':desc}</span>
  </div>;
}

export default function App() {
  const [listings,setListings]=useState<any[]|null>(null);
  const [sites,setSites]=useState<any[]|null>(null);
  const [users,setUsers]=useState<any[]|null>(null);
  const [referrals,setReferrals]=useState<any[]|null>(null);
  const [listingHeaders,setListingHeaders]=useState<{raw:string;mapped:string;inMap:boolean;sample:string}[]>([]);
  const [siteHeaders,setSiteHeaders]=useState<{raw:string;mapped:string;inMap:boolean;sample:string}[]>([]);
  const [userHeaders,setUserHeaders]=useState<{raw:string;mapped:string;inMap:boolean;sample:string}[]>([]);
  const [referralHeaders,setReferralHeaders]=useState<{raw:string;mapped:string;inMap:boolean;sample:string}[]>([]);
  const [gf,setGf]=useState<string>('province');
  const [tab,setTab]=useState('overview');
  const [sq,setSq]=useState('');
  const [sf,setSf]=useState('total');
  const [sd,setSd]=useState<'asc'|'desc'>('desc');
  const [stq,setStq]=useState('');
  const [stf,setStf]=useState('absDelta');
  const [std2,setStd2]=useState<'asc'|'desc'>('desc');
  const [expandedSite,setExpandedSite]=useState<string|null>(null);
  const [includeTest,setIncludeTest]=useState(true);
  const [rtSec,setRtSec]=useState<'target'|'source'|'sender'>('target');
  const [rtq,setRtq]=useState('');
  const [rtf,setRtf]=useState('totalRefs');
  const [rtd,setRtd]=useState<'asc'|'desc'>('desc');
  const [rtExpanded,setRtExpanded]=useState<string|null>(null);

  const ok=listings&&sites&&users;
  const any1=listings||sites||users||referrals;
  const testCount=useMemo(()=>listings?listings.filter(l=>l.testMode==='TRUE').length:0,[listings]);
  const fls=useMemo(()=>{
    if(!listings) return null;
    return includeTest?listings:listings.filter(l=>l.testMode!=='TRUE');
  },[listings,includeTest]);

  const ls=useMemo(()=>{
    if(!fls) return null;
    const t=fls.length, eR=fls.filter(l=>l.eReferrals==='ENABLED').length, eC=fls.filter(l=>l.eConsults==='ENABLED').length, ap=fls.filter(l=>(l.raApprovalStatus||'').toUpperCase()==='APPROVED').length, pe=fls.filter(l=>(l.raApprovalStatus||'').toUpperCase()==='PENDING').length, cc=fls.filter(l=>l.CCEnabled==='CC_ENABLED').length, sk=fls.filter(l=>l.CCSEK==='SEK_STORED').length, co=fls.filter(l=>l.listingRepositoryContribution==='CONTRIBUTING').length, tm=fls.filter(l=>l.testMode==='TRUE').length, tr=fls.filter(l=>l.trusteeCustodian==='TRUSTEE_CUSTODIAN').length, nt=fls.filter(l=>l.trusteeCustodian==='NON_TRUSTEE_CUSTODIAN').length, ut=fls.filter(l=>l.trusteeCustodian==='UNSPECIFIED').length, na=fls.filter(l=>l.trusteeCustodian==='NOT_ACCEPTING_EREFERRALS').length;
    const tp:Record<string,number>={};
    fls.forEach(l=>{const x=l.listingType||'Unknown';tp[x]=(tp[x]||0)+1;});
    const gm:Record<string,{total:number;enabled:number}>={};
    fls.forEach(l=>{const key=l[gf]||'Unspecified';if(!gm[key])gm[key]={total:0,enabled:0};gm[key].total++;if(l.eReferrals==='ENABLED')gm[key].enabled++;});
    const gd=Object.entries(gm).map(([region,d])=>({region,...d,rate:Math.round(P(d.enabled,d.total))}));
    return {total:t,eRefEnabled:eR,eConEnabled:eC,approved:ap,pending:pe,ccEnabled:cc,sekStored:sk,contributing:co,testMode:tm,trustee:tr,nonTrustee:nt,unspecTrustee:ut,notAccepting:na,typeMap:tp,geoData:gd};
  },[fls,gf]);

  const ss=useMemo(()=>{
    if(!sites) return null;
    const t=sites.length, v=sites.filter(s=>s.validatedSite==='TRUE').length, pm=sites.filter(s=>s.patientMessagingEnabled==='TRUE').length, ob=sites.filter(s=>s.onlineBookingEnabled==='TRUE').length, tf=sites.reduce((s,r)=>s+(parseFloat(r.estimatedFees)||0),0), tpl=sites.reduce((s,r)=>s+(parseInt(r.patientMessagingLicences)||0),0), tol=sites.reduce((s,r)=>s+(parseInt(r.onlineBookingLicences)||0),0);
    const em:Record<string,number>={};
    sites.forEach(s=>{const e=s.emr||'None';em[e]=(em[e]||0)+1;});
    return {total:t,validated:v,pmEnabled:pm,obEnabled:ob,totalFees:tf,totalPmLic:tpl,totalObLic:tol,emrMap:em,withListings:sites.filter(s=>parseInt(s.approvedListings)>0).length};
  },[sites]);

  const us=useMemo(()=>{
    if(!users) return null;
    const t=users.length, v=users.filter(u=>u.valid==='TRUE').length;
    const rm:Record<string,number>={};users.forEach(u=>{const r=u.clinicianType||'Unknown';rm[r]=(rm[r]||0)+1;});
    const mm:Record<string,number>={};users.forEach(u=>{const fd=fmtDate(u.dateOfAgreement);if(fd&&fd.length>=7){const m=fd.substring(0,7);mm[m]=(mm[m]||0)+1;}});
    let cum=0;const tl=Object.keys(mm).sort().map(m=>{cum+=mm[m];return{label:m,value:mm[m],cumulative:cum};});
    const vm:Record<string,number>={};users.forEach(u=>{const x=u.licenseVersion||'Unknown';vm[x]=(vm[x]||0)+1;});
    const suc:Record<string,number>={};users.forEach(u=>{if(u.siteNumbers)u.siteNumbers.split(';').map((s:string)=>s.trim()).filter(Boolean).forEach((sn:string)=>{const k=normSN(sn);suc[k]=(suc[k]||0)+1;});});
    return {total:t,valid:v,roleMap:rm,timeline:tl,versionMap:vm,siteUserCount:suc};
  },[users]);

  const sm=useMemo(()=>{
    if(!fls||!sites) return null;
    const slm:Record<string,{total:number;eR:number;eC:number;cc:number}>={};
    fls.forEach(l=>{const sn=normSN(l.siteNum);if(!slm[sn])slm[sn]={total:0,eR:0,eC:0,cc:0};slm[sn].total++;if(l.eReferrals==='ENABLED')slm[sn].eR++;if(l.eConsults==='ENABLED')slm[sn].eC++;if(l.CCEnabled==='CC_ENABLED')slm[sn].cc++;});
    return sites.map(s=>{const k=normSN(s.siteNumber);const lm=slm[k]||{total:0,eR:0,eC:0,cc:0};const uc=us?.siteUserCount[k]||0;return{siteNum:s.siteNumber,siteName:s.siteName,total:lm.total,eRefEnabled:lm.eR,eConEnabled:lm.eC,ccEnabled:lm.cc,userCount:uc,validated:s.validatedSite==='TRUE',emr:s.emr,adoptionRate:P(lm.eR,lm.total)};});
  },[fls,sites,us]);

  const staffing=useMemo(()=>{
    if(!fls||!sites) return null;
    const siteLm:Record<string,{raClinTotal:number;listingDetails:{ref:string;title:string;raClinCount:number;eReferrals:string;eConsults:string;listingType:string;claimedByUser:string;clinicianProfId:string}[]}>={};
    fls.forEach(l=>{
      const sn=normSN(l.siteNum);
      if(!siteLm[sn]) siteLm[sn]={raClinTotal:0,listingDetails:[]};
      const rc=parseInt(l.raCliniciansCount)||0;
      siteLm[sn].raClinTotal+=rc;
      siteLm[sn].listingDetails.push({ref:l.ref||'',title:l.title||'Untitled',raClinCount:rc,eReferrals:l.eReferrals||'',eConsults:l.eConsults||'',listingType:l.listingType||'',claimedByUser:l.claimedByUser||'',clinicianProfId:l.clinicianProfessionalId||''});
    });
    return sites.map(s=>{
      const k=normSN(s.siteNumber);
      const uc=us?.siteUserCount[k]||0;
      const sl=siteLm[k]||{raClinTotal:0,listingDetails:[]};
      const delta=uc-sl.raClinTotal;
      return {siteNum:s.siteNumber,siteName:s.siteName,emr:s.emr,userCount:uc,raClinTotal:sl.raClinTotal,delta,absDelta:Math.abs(delta),listingCount:sl.listingDetails.length,details:sl.listingDetails};
    });
  },[fls,sites,us]);

  const fStaff=useMemo(()=>{
    if(!staffing) return null;
    let r=staffing;
    if(stq.trim()){const q=stq.toLowerCase();r=r.filter(s=>(s.siteName||'').toLowerCase().includes(q)||(s.siteNum||'').toLowerCase().includes(q));}
    return [...r].sort((a,b)=>{let av:any,bv:any;
      if(stf==='siteName'){av=(a.siteName||'').toLowerCase();bv=(b.siteName||'').toLowerCase();}
      else if(stf==='siteNum'){av=parseInt(a.siteNum)||0;bv=parseInt(b.siteNum)||0;}
      else{av=(a as any)[stf]??0;bv=(b as any)[stf]??0;}
      return av<bv?(std2==='asc'?-1:1):av>bv?(std2==='asc'?1:-1):0;
    });
  },[staffing,stq,stf,std2]);

  const dq=useMemo(()=>{
    if(!fls||!sites||!users) return null;
    const siteSet=new Set(sites.map(s=>normSN(s.siteNumber)));
    const listingSNSet=new Set(fls.map(l=>normSN(l.siteNum)));

    // All unique normalized site numbers from users (exploded from semicolons)
    const userSNMap:Record<string,{users:string[];count:number}>={};
    const blankSiteUsers:typeof users=[];
    users.forEach(u=>{
      const raw=(u.siteNumbers||'').trim();
      if(!raw){blankSiteUsers.push(u);return;}
      raw.split(';').map((s:string)=>s.trim()).filter(Boolean).forEach((sn:string)=>{
        const k=normSN(sn);
        if(!userSNMap[k]) userSNMap[k]={users:[],count:0};
        userSNMap[k].users.push(u.userName||u.name||'Unknown');
        userSNMap[k].count++;
      });
    });

    // All unique normalized site numbers from listings
    const listingSNMap:Record<string,number>={};
    fls.forEach(l=>{const k=normSN(l.siteNum);listingSNMap[k]=(listingSNMap[k]||0)+1;});

    // 1. Coverage matrix
    const userSNs=Object.keys(userSNMap);
    const userSNMatched=userSNs.filter(k=>siteSet.has(k));
    const userSNOrphaned=userSNs.filter(k=>!siteSet.has(k));
    const userLinksTotal=Object.values(userSNMap).reduce((s,v)=>s+v.count,0);
    const userLinksMatched=userSNMatched.reduce((s,k)=>s+userSNMap[k].count,0);
    const userLinksOrphaned=userSNOrphaned.reduce((s,k)=>s+userSNMap[k].count,0);

    const listSNs=Object.keys(listingSNMap);
    const listSNMatched=listSNs.filter(k=>siteSet.has(k));
    const listSNOrphaned=listSNs.filter(k=>!siteSet.has(k));
    const listLinksMatched=listSNMatched.reduce((s,k)=>s+listingSNMap[k],0);
    const listLinksOrphaned=listSNOrphaned.reduce((s,k)=>s+listingSNMap[k],0);

    const userSNInListings=userSNs.filter(k=>listingSNSet.has(k));
    const userSNNotInListings=userSNs.filter(k=>!listingSNSet.has(k));

    // 2. Orphaned users detail: users whose ALL site numbers are orphaned (none in Sites)
    const orphanedUsers=users.filter(u=>{
      const raw=(u.siteNumbers||'').trim();
      if(!raw) return false;
      const sns=raw.split(';').map((s:string)=>s.trim()).filter(Boolean).map(normSN);
      return sns.length>0&&sns.every(k=>!siteSet.has(k));
    }).map(u=>({name:u.userName||u.name||'Unknown',clinicianType:u.clinicianType||'',siteNumbers:u.siteNumbers||'',dateOfAgreement:fmtDate(u.dateOfAgreement)||''}));

    // Also: users with at least one orphaned SN (partial orphans)
    const partialOrphanUsers=users.filter(u=>{
      const raw=(u.siteNumbers||'').trim();
      if(!raw) return false;
      const sns=raw.split(';').map((s:string)=>s.trim()).filter(Boolean).map(normSN);
      return sns.some(k=>!siteSet.has(k))&&sns.some(k=>siteSet.has(k));
    }).length;

    // 3. Orphaned site numbers inventory
    const allOrphanedSNs=[...new Set([...userSNOrphaned,...listSNOrphaned])].map(k=>({
      siteNumber:k,
      userCount:userSNMap[k]?.count||0,
      listingCount:listingSNMap[k]||0,
      sampleUsers:(userSNMap[k]?.users||[]).slice(0,5)
    })).sort((a,b)=>(b.userCount+b.listingCount)-(a.userCount+a.listingCount));

    // 4. Blank site number users
    const blankUsers=blankSiteUsers.map(u=>({name:u.userName||u.name||'Unknown',clinicianType:u.clinicianType||'',dateOfAgreement:fmtDate(u.dateOfAgreement)||'',email:u.email||''}));

    return {
      coverage:{
        userToSite:{uniqueSNs:userSNs.length,matched:userSNMatched.length,orphaned:userSNOrphaned.length,linksTotal:userLinksTotal,linksMatched:userLinksMatched,linksOrphaned:userLinksOrphaned},
        listingToSite:{uniqueSNs:listSNs.length,matched:listSNMatched.length,orphaned:listSNOrphaned.length,linksMatched:listLinksMatched,linksOrphaned:listLinksOrphaned},
        userToListing:{inListings:userSNInListings.length,notInListings:userSNNotInListings.length}
      },
      orphanedUsers,partialOrphanUsers,
      orphanedSNs:allOrphanedSNs,
      blankUsers
    };
  },[fls,sites,users]);

  const fRefs=useMemo(()=>{
    if(!referrals) return null;
    return includeTest?referrals:referrals.filter(r=>r.sentToTestListing!=='TRUE');
  },[referrals,includeTest]);

  const refTestCount=useMemo(()=>referrals?referrals.filter(r=>r.sentToTestListing==='TRUE').length:0,[referrals]);

  const ra=useMemo(()=>{
    if(!fRefs) return null;
    const siteNameLookup:Record<string,string>={};
    const siteEmrLookup:Record<string,string>={};
    if(sites) sites.forEach(s=>{const k=normSN(s.siteNumber);siteNameLookup[k]=s.siteName;siteEmrLookup[k]=s.emr||'';});
    const listingTitleLookup:Record<string,string>={};
    if(listings) listings.forEach(l=>{if(l.ref) listingTitleLookup[l.ref]=l.title||'Untitled';});
    const userNameLookup:Record<string,{name:string;clinicianType:string}>={};
    if(users) users.forEach(u=>{if(u.userName) userNameLookup[u.userName]={name:u.name||'',clinicianType:u.clinicianType||''};});

    // Date helpers
    const now=new Date();const curM=now.toISOString().slice(0,7);
    const mOff=(m:string,off:number)=>{const d=new Date(m+'-01');d.setMonth(d.getMonth()+off);return d.toISOString().slice(0,7);};
    const lastFullM=mOff(curM,-1);const cmp1M=mOff(curM,-2);const cmp3M=mOff(curM,-4);const cmp12M=mOff(curM,-13);

    // Monthly timeline
    const mm:Record<string,number>={};
    fRefs.forEach(r=>{const fd=fmtDate(r.referralCreationDate);if(fd&&fd.length>=7){const m=fd.substring(0,7);mm[m]=(mm[m]||0)+1;}});
    let cum=0;
    const timeline=Object.keys(mm).sort().map(m=>{cum+=mm[m];return{label:m,value:mm[m],cumulative:cum};});
    const curMCount=mm[curM]||0;const lastFullCount=mm[lastFullM]||0;
    const cmp1Count=mm[cmp1M]||0;const cmp3Count=mm[cmp3M]||0;const cmp12Count=mm[cmp12M]||0;
    const pctChg=(cur:number,prev:number):{val:string;num:number}=>prev===0?{val:'N/A',num:0}:{val:(Math.round(((cur-prev)/prev)*1000)/10>=0?'+':'')+Math.round(((cur-prev)/prev)*1000)/10+'%',num:Math.round(((cur-prev)/prev)*1000)/10};
    const chg1=pctChg(lastFullCount,cmp1Count);const chg3=pctChg(lastFullCount,cmp3Count);const chg12=pctChg(lastFullCount,cmp12Count);
    // Earliest data date for N/A context
    const allDates=fRefs.map(r=>fmtDate(r.referralCreationDate)).filter(d=>d&&d.length>=10).sort();
    const earliestDate=allDates.length>0?allDates[0]:'';

    // Weekly timeline with test split
    const wk:Record<string,{total:number;test:number;nonTest:number;senders:Set<string>;receivers:Set<string>}>={};
    (referrals||[]).forEach(r=>{
      const fd=fmtDate(r.referralCreationDate);if(!fd||fd.length<10) return;
      const d=new Date(fd.substring(0,10)+'T00:00:00Z');const day=d.getUTCDay();const diff=d.getUTCDate()-day+(day===0?-6:1);
      d.setUTCDate(diff);const wkKey=d.toISOString().slice(0,10);
      if(!wk[wkKey]) wk[wkKey]={total:0,test:0,nonTest:0,senders:new Set(),receivers:new Set()};
      wk[wkKey].total++;
      const isTest=r.sentToTestListing==='TRUE';
      if(isTest) wk[wkKey].test++; else wk[wkKey].nonTest++;
      if(!isTest){if(r.referrerProfessionalId) wk[wkKey].senders.add(r.referrerProfessionalId);if(r.referralTargetRef) wk[wkKey].receivers.add(r.referralTargetRef);}
    });
    const weekly=Object.keys(wk).sort().map(w=>({label:w,total:wk[w].total,test:wk[w].test,nonTest:wk[w].nonTest,senders:wk[w].senders.size,receivers:wk[w].receivers.size}));

    // By target site
    const tgt:Record<string,{siteName:string;totalRefs:number;senders:Set<string>;states:Record<string,number>;listings:Record<string,{title:string;count:number}>}>={};
    fRefs.forEach(r=>{
      const sn=normSN(r.siteNum);
      if(!tgt[sn]) tgt[sn]={siteName:siteNameLookup[sn]||r.recipientName||sn,totalRefs:0,senders:new Set(),states:{},listings:{}};
      tgt[sn].totalRefs++;
      if(r.referredByUserName) tgt[sn].senders.add(r.referredByUserName);
      const st=r.referralState||'UNKNOWN';tgt[sn].states[st]=(tgt[sn].states[st]||0)+1;
      const lref=r.referralTargetRef||'';
      if(lref){if(!tgt[sn].listings[lref]) tgt[sn].listings[lref]={title:listingTitleLookup[lref]||r.recipientName||lref,count:0};tgt[sn].listings[lref].count++;}
    });
    const byTarget=Object.entries(tgt).map(([sn,d])=>({siteNum:sn,siteName:d.siteName,totalRefs:d.totalRefs,uniqueSenders:d.senders.size,states:d.states,listings:Object.entries(d.listings).map(([ref,ld])=>({ref,title:ld.title,count:ld.count})).sort((a,b)=>b.count-a.count)})).sort((a,b)=>b.totalRefs-a.totalRefs);

    // By source site
    const src:Record<string,{siteName:string;totalRefs:number;targets:Set<string>;users:Set<string>}>={};
    fRefs.forEach(r=>{
      const sn=normSN(r.srcsiteNum);if(!sn) return;
      if(!src[sn]) src[sn]={siteName:siteNameLookup[sn]||r.srcSiteName||sn,totalRefs:0,targets:new Set(),users:new Set()};
      src[sn].totalRefs++;src[sn].targets.add(normSN(r.siteNum));
      if(r.referredByUserName) src[sn].users.add(r.referredByUserName);
    });
    const bySource=Object.entries(src).map(([sn,d])=>({siteNum:sn,siteName:d.siteName,totalRefs:d.totalRefs,uniqueTargets:d.targets.size,uniqueUsers:d.users.size})).sort((a,b)=>b.totalRefs-a.totalRefs);

    // By sender
    const snd:Record<string,{fullName:string;clinicianType:string;profId:string;totalRefs:number;targets:Set<string>;targetListings:Set<string>;srcSites:Record<string,{name:string;count:number}>}>={};
    let unknownSenderCount=0;const unknownTargets=new Set<string>();const unknownListings=new Set<string>();const unknownSrcSites:Record<string,{name:string;count:number}>={};
    fRefs.forEach(r=>{
      const un=r.referredByUserName||'';
      const srcSn=normSN(r.srcsiteNum);const srcName=siteNameLookup[srcSn]||r.srcSiteName||srcSn||'Unknown';
      if(!un){unknownSenderCount++;unknownTargets.add(normSN(r.siteNum));if(r.referralTargetRef) unknownListings.add(r.referralTargetRef);if(srcSn){if(!unknownSrcSites[srcSn]) unknownSrcSites[srcSn]={name:srcName,count:0};unknownSrcSites[srcSn].count++;}return;}
      if(!snd[un]) snd[un]={fullName:r.referredByUserFullName||userNameLookup[un]?.name||un,clinicianType:r.referrerClinicianType||userNameLookup[un]?.clinicianType||'',profId:r.referrerProfessionalId||'',totalRefs:0,targets:new Set(),targetListings:new Set(),srcSites:{}};
      snd[un].totalRefs++;snd[un].targets.add(normSN(r.siteNum));
      if(r.referralTargetRef) snd[un].targetListings.add(r.referralTargetRef);
      if(!snd[un].profId&&r.referrerProfessionalId) snd[un].profId=r.referrerProfessionalId;
      if(srcSn){if(!snd[un].srcSites[srcSn]) snd[un].srcSites[srcSn]={name:srcName,count:0};snd[un].srcSites[srcSn].count++;}
    });
    const mapSrc=(ss:Record<string,{name:string;count:number}>)=>Object.entries(ss).map(([sn,d])=>({siteNum:sn,siteName:d.name,count:d.count})).sort((a,b)=>b.count-a.count);
    const bySenderRows=Object.entries(snd).map(([un,d])=>({userName:un,fullName:d.fullName,clinicianType:d.clinicianType,profId:d.profId,totalRefs:d.totalRefs,uniqueTargets:d.targets.size,uniqueListings:d.targetListings.size,isUnknown:false,srcSites:mapSrc(d.srcSites)})).sort((a,b)=>b.totalRefs-a.totalRefs);
    const bySender=unknownSenderCount>0?[{userName:'',fullName:'(Unknown sender)',clinicianType:'',profId:'',totalRefs:unknownSenderCount,uniqueTargets:unknownTargets.size,uniqueListings:unknownListings.size,isUnknown:true,srcSites:mapSrc(unknownSrcSites)},...bySenderRows]:bySenderRows;

    // Donut: Target Region (from listings healthRegion via referralTargetRef)
    const regionLookup:Record<string,string>={};
    if(listings) listings.forEach(l=>{if(l.ref) regionLookup[l.ref]=l.healthRegion||'';});
    const regionMap:Record<string,number>={};
    fRefs.forEach(r=>{
      const tRef=r.referralTargetRef||'';
      let region:string;
      if(!tRef||!(tRef in regionLookup)){region='Referrals not mapped to listings';}
      else if(!regionLookup[tRef]){region='Region not defined';}
      else{region=regionLookup[tRef];}
      regionMap[region]=(regionMap[region]||0)+1;
    });
    const byRegionSorted=Object.entries(regionMap).sort((a,b)=>b[1]-a[1]);
    const topRegions=byRegionSorted.slice(0,10);const otherRegions=byRegionSorted.slice(10).reduce((s,e)=>s+e[1],0);
    const byRegion=[...topRegions.map(([l,v])=>({label:l,value:v})),...(otherRegions>0?[{label:'All others',value:otherRegions}]:[])];

    // Donut: Health Service Category
    const svcMap:Record<string,number>={};fRefs.forEach(r=>{const s=r.currentHealthService||r.initialHealthService||'Unknown';svcMap[s]=(svcMap[s]||0)+1;});
    const bySvcSorted=Object.entries(svcMap).sort((a,b)=>b[1]-a[1]);
    const topSvc=bySvcSorted.slice(0,10);const otherSvc=bySvcSorted.slice(10).reduce((s,e)=>s+e[1],0);
    const byService=[...topSvc.map(([l,v])=>({label:l,value:v})),...(otherSvc>0?[{label:'All others',value:otherSvc}]:[])];

    // Donut: Referrer Clinician Type
    const ctMap:Record<string,number>={};fRefs.forEach(r=>{const c=r.referrerClinicianType||'Unknown';ctMap[c]=(ctMap[c]||0)+1;});
    const byCtSorted=Object.entries(ctMap).sort((a,b)=>b[1]-a[1]);
    const topCt=byCtSorted.slice(0,10);const otherCt=byCtSorted.slice(10).reduce((s,e)=>s+e[1],0);
    const byClinType=[...topCt.map(([l,v])=>({label:l,value:v})),...(otherCt>0?[{label:'All others',value:otherCt}]:[])];

    // EMR breakdowns
    const emrSent:Record<string,number>={};const emrRecv:Record<string,number>={};
    fRefs.forEach(r=>{
      const srcK=normSN(r.srcsiteNum);const tgtK=normSN(r.siteNum);
      const srcEmr=siteEmrLookup[srcK]||'Unknown EMR';const tgtEmr=siteEmrLookup[tgtK]||'Unknown EMR';
      emrSent[srcEmr]=(emrSent[srcEmr]||0)+1;emrRecv[tgtEmr]=(emrRecv[tgtEmr]||0)+1;
    });
    const byEmrSent=Object.entries(emrSent).sort((a,b)=>b[1]-a[1]).map(([l,v])=>({label:l||'None',value:v}));
    const byEmrRecv=Object.entries(emrRecv).sort((a,b)=>b[1]-a[1]).map(([l,v])=>({label:l||'None',value:v}));

    // Referral Source / FHIR
    const srcMap:Record<string,number>={};fRefs.forEach(r=>{const s=r.referralSource||'Unknown';srcMap[s]=(srcMap[s]||0)+1;});
    const fhirCount=Object.entries(srcMap).filter(([k])=>k.toUpperCase().includes('FHIR')).reduce((s,e)=>s+e[1],0);

    // Unique counts
    const uniqueProfIds=new Set(fRefs.map(r=>r.referrerProfessionalId).filter(Boolean)).size;
    const uniqueTargetRefs=new Set(fRefs.map(r=>r.referralTargetRef).filter(Boolean)).size;
    const distinctRefs=new Set(fRefs.map(r=>r.referralRef).filter(Boolean)).size;

    return {
      total:fRefs.length,distinctRefs,
      uniqueSendingSites:new Set(fRefs.map(r=>normSN(r.srcsiteNum)).filter(Boolean)).size,
      uniqueTargetSites:new Set(fRefs.map(r=>normSN(r.siteNum)).filter(Boolean)).size,
      uniqueSenders:new Set(fRefs.map(r=>r.referredByUserName).filter(Boolean)).size,
      uniqueProfIds,uniqueTargetRefs,
      curMCount,curM,lastFullM,lastFullCount,
      chg1,cmp1M,cmp1Count,chg3,cmp3M,cmp3Count,chg12,cmp12M,cmp12Count,earliestDate,
      fhirCount,fhirPct:P(fhirCount,fRefs.length),
      timeline,weekly,byTarget,bySource,bySender,
      byRegion,byService,byClinType,byEmrSent,byEmrRecv
    };
  },[fRefs,referrals,sites,listings,users]);

  const fRa=useMemo(()=>{
    if(!ra) return null;
    const list=rtSec==='target'?ra.byTarget:rtSec==='source'?ra.bySource:ra.bySender;
    const pinned=list.filter((s:any)=>s.isUnknown);
    let r=list.filter((s:any)=>!s.isUnknown) as any[];
    if(rtq.trim()){const q=rtq.toLowerCase();r=r.filter((s:any)=>Object.values(s).some(v=>typeof v==='string'&&v.toLowerCase().includes(q)));}
    r.sort((a:any,b:any)=>{let av=a[rtf]??0,bv=b[rtf]??0;if(typeof av==='string'){av=av.toLowerCase();bv=(bv as string).toLowerCase();}return av<bv?(rtd==='asc'?-1:1):av>bv?(rtd==='asc'?1:-1):0;});
    return [...pinned,...r];
  },[ra,rtSec,rtq,rtf,rtd]);

  const doRtSort=(f:string)=>{if(rtf===f)setRtd(d=>d==='asc'?'desc':'asc');else{setRtf(f);setRtd('desc');}};
  const rtIco=(f:string)=>rtf!==f?' \u21D5':rtd==='asc'?' \u2191':' \u2193';
  const rtTh=(f:string):React.CSSProperties=>({padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase',cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',background:rtf===f?clr.bd+'44':'transparent',borderRadius:4});

  const fm=useMemo(()=>{
    if(!sm) return null;
    let r=sm;
    if(sq.trim()){const q=sq.toLowerCase();r=r.filter(s=>(s.siteName||'').toLowerCase().includes(q)||(s.siteNum||'').toLowerCase().includes(q)||(s.emr||'').toLowerCase().includes(q));}
    return [...r].sort((a,b)=>{let av:any,bv:any;
      if(sf==='siteName'){av=(a.siteName||'').toLowerCase();bv=(b.siteName||'').toLowerCase();}
      else if(sf==='emr'){av=(a.emr||'').toLowerCase();bv=(b.emr||'').toLowerCase();}
      else if(sf==='siteNum'){av=parseInt(a.siteNum)||0;bv=parseInt(b.siteNum)||0;}
      else if(sf==='validated'){av=+!!a.validated;bv=+!!b.validated;}
      else{av=(a as any)[sf]||0;bv=(b as any)[sf]||0;}
      return av<bv?(sd==='asc'?-1:1):av>bv?(sd==='asc'?1:-1):0;
    });
  },[sm,sq,sf,sd]);

  const doSort=(f:string)=>{if(sf===f)setSd(d=>d==='asc'?'desc':'asc');else{setSf(f);setSd('desc');}};
  const sIco=(f:string)=>sf!==f?' \u21D5':sd==='asc'?' \u2191':' \u2193';
  const thS=(f:string):React.CSSProperties=>({padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase',cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',background:sf===f?clr.bd+'44':'transparent',borderRadius:4});
  const doStSort=(f:string)=>{if(stf===f)setStd2(d=>d==='asc'?'desc':'asc');else{setStf(f);setStd2('desc');}};
  const stIco=(f:string)=>stf!==f?' \u21D5':std2==='asc'?' \u2191':' \u2193';
  const stTh=(f:string):React.CSSProperties=>({padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase',cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',background:stf===f?clr.bd+'44':'transparent',borderRadius:4});
  const deltaColor=(d:number,rc:number)=>{if(rc===0&&d===0) return clr.dm; const ratio=rc>0?Math.abs(d)/rc:Math.abs(d)>0?1:0; if(ratio<=0.2) return clr.gn; if(ratio<=0.5) return clr.am; return clr.rd;};

  return <div style={{minHeight:'100vh',background:clr.bg,color:clr.tx,fontFamily:"'DM Sans',system-ui,sans-serif"}}>
    <link href='https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap' rel='stylesheet'/>
    <div style={{background:'linear-gradient(135deg,#0f172a 0%,#1e1b4b 50%,#0f172a 100%)',borderBottom:'1px solid '+clr.bd,padding:'20px 32px'}}>
      <div style={{maxWidth:1400,margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:12}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:36,height:36,borderRadius:8,background:'linear-gradient(135deg,'+clr.ac+','+clr.pu+')',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,fontWeight:800,color:'#fff'}}>O</div>
            <h1 style={{fontSize:22,fontWeight:800,letterSpacing:-0.5,margin:0}}>Ocean eReferral Adoption Dashboard</h1>
          </div>
          <p style={{fontSize:13,color:clr.dm,marginTop:4,marginLeft:48,marginBottom:0}}>Regional Authority \u2014 Onboarding & Adoption Analytics</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {([['Listings',listings],['Sites',sites],['Users',users],['Referrals',referrals]] as [string,any][]).map(([l,d])=><span key={l} style={{fontSize:12,padding:'4px 10px',borderRadius:6,background:d?clr.gd:'transparent',color:d?clr.gn:clr.dm,border:'1px solid '+(d?clr.gn+'66':clr.bd),fontWeight:600}}>{l} {d?d.length:'\u2014'}</span>)}
          {listings&&testCount>0&&<div style={{display:'flex',alignItems:'center',gap:8,marginLeft:8,padding:'4px 12px',borderRadius:6,background:includeTest?'transparent':clr.am+'18',border:'1px solid '+(includeTest?clr.bd:clr.am+'66')}}>
            <span style={{fontSize:12,color:includeTest?clr.dm:clr.am,fontWeight:500}}>Test Listings</span>
            <div onClick={()=>setIncludeTest(p=>!p)} style={{width:36,height:20,borderRadius:10,background:includeTest?clr.gn+'66':clr.bd,cursor:'pointer',position:'relative',transition:'background 0.2s'}}>
              <div style={{width:16,height:16,borderRadius:8,background:includeTest?clr.gn:'#fff',position:'absolute',top:2,left:includeTest?18:2,transition:'left 0.2s, background 0.2s',boxShadow:'0 1px 3px rgba(0,0,0,0.3)'}}/>
            </div>
          </div>}
        </div>
      </div>
    </div>
    <div style={{maxWidth:1400,margin:'0 auto',padding:'24px 32px'}}>
      {!includeTest&&listings&&<div style={{background:clr.am+'15',border:'1px solid '+clr.am+'44',borderRadius:8,padding:'10px 16px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:16}}>&#9888;</span>
          <span style={{fontSize:13,color:clr.am,fontWeight:600}}>Excluding {testCount} test listing{testCount!==1?'s':''}{referrals?' and '+refTestCount+' test referral'+(refTestCount!==1?'s':''):''}</span>
          <span style={{fontSize:12,color:clr.mu}}>— showing {(listings.length-testCount).toLocaleString()} of {listings.length.toLocaleString()} listings{referrals?' and '+(referrals.length-refTestCount).toLocaleString()+' of '+referrals.length.toLocaleString()+' referrals':''} across all tabs</span>
        </div>
        <button onClick={()=>setIncludeTest(true)} style={{fontSize:11,color:clr.am,background:'transparent',border:'1px solid '+clr.am+'44',borderRadius:4,padding:'3px 10px',cursor:'pointer',fontWeight:600}}>Include All</button>
      </div>}
      {!ok&&<div style={{marginBottom:32}}>
        <h2 style={{fontSize:16,fontWeight:700,marginBottom:16,color:clr.mu}}>Load your Regional Authority export files to begin</h2>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16}}>
          <Upload label='Export Listings' desc='Upload the Listings export (.xlsx)' loaded={!!listings} onLoad={buf=>{const r=parseFile(buf,LISTING_MAP);setListings(r.rows);setListingHeaders(r.headerDiag);}}/>
          <Upload label='Export Sites' desc='Upload the Sites export (.xlsx)' loaded={!!sites} onLoad={buf=>{const r=parseFile(buf,SITE_MAP);setSites(r.rows);setSiteHeaders(r.headerDiag);}}/>
          <Upload label='Export Users' desc='Upload the Users export (.xlsx)' loaded={!!users} onLoad={buf=>{const r=parseFile(buf,USER_MAP);setUsers(r.rows);setUserHeaders(r.headerDiag);}}/>
          <Upload label='Referral Analytics' desc='Upload the Referral Analytics export (.xlsx)' loaded={!!referrals} onLoad={buf=>{const r=parseFile(buf,REFERRAL_MAP);setReferrals(r.rows);setReferralHeaders(r.headerDiag);}}/>
        </div>
        {any1&&!ok&&<p style={{fontSize:13,color:clr.am,marginTop:12}}>Upload Listings, Sites, and Users for complete cross-file analytics. Referral Analytics is optional.</p>}
      </div>}
      {ok&&<div style={{display:'flex',gap:12,marginBottom:20,alignItems:'center',flexWrap:'wrap'}}>
        <button onClick={()=>{setListings(null);setSites(null);setUsers(null);setReferrals(null);setListingHeaders([]);setSiteHeaders([]);setUserHeaders([]);setReferralHeaders([]);setTab('overview');}} style={{fontSize:12,color:clr.dm,background:clr.cd,border:'1px solid '+clr.bd,borderRadius:6,padding:'6px 14px',cursor:'pointer'}}>\u21BB Reload files</button>
        {!referrals&&<Upload label='Referral Analytics' desc='Upload to enable referral tab' loaded={false} onLoad={buf=>{const r=parseFile(buf,REFERRAL_MAP);setReferrals(r.rows);setReferralHeaders(r.headerDiag);}}/>}
      </div>}
      {any1&&<Tabs value={tab} onValueChange={setTab}>
        <TabsList style={{background:clr.cd,borderRadius:8,marginBottom:24,border:'1px solid '+clr.bd}}>
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
            {ls&&<><KPI label='Total Listings' value={ls.total} color={clr.ac}/><KPI label='eReferral Enabled' value={ls.eRefEnabled} sub={P(ls.eRefEnabled,ls.total)+'% of listings'} color={clr.gn}/><KPI label='eConsult Enabled' value={ls.eConEnabled} sub={P(ls.eConEnabled,ls.total)+'% of listings'} color={clr.pu}/><KPI label='RA Approved' value={ls.approved} sub={ls.pending+' pending'} color={clr.am}/></>}
            {ss&&<><KPI label='Total Sites' value={ss.total} color={clr.bl}/><KPI label='Validated Sites' value={ss.validated} sub={P(ss.validated,ss.total)+'% validated'} color={clr.gn}/><KPI label='Monthly Licence Fees' value={'$'+ss.totalFees.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} color={clr.am}/><KPI label='Sites with Listings' value={ss.withListings} sub={P(ss.withListings,ss.total)+'% active'} color={clr.ac}/></>}
            {us&&<><KPI label='Total Users' value={us.total} color={clr.ac}/><KPI label='Valid Agreements' value={us.valid} sub={P(us.valid,us.total)+'% valid'} color={clr.gn}/><KPI label='Roles Represented' value={Object.keys(us.roleMap).length} color={clr.pu}/><KPI label='Agreement Versions' value={Object.keys(us.versionMap).length} color={clr.bl}/></>}
          </div>
          {ls&&<div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24,marginBottom:20}}>
            <h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>eReferral Adoption Funnel</h3>
            <Funnel steps={[{label:'Total Listings',value:ls.total,color:clr.ac},{label:'RA Approved',value:ls.approved,color:clr.bl},{label:'Cloud Connect On',value:ls.ccEnabled,color:clr.pu},{label:'SEK Stored',value:ls.sekStored,color:clr.am},{label:'eReferral Enabled',value:ls.eRefEnabled,color:clr.gn},{label:'Contributing to Repo',value:ls.contributing,color:'#2dd4bf'}]}/>
          </div>}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            {ls&&<div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Trustee / Custodian Status</h3><Donut segments={[{label:'Trustee/Custodian',value:ls.trustee,color:clr.gn},{label:'Non-Trustee',value:ls.nonTrustee,color:clr.bl},{label:'Unspecified',value:ls.unspecTrustee,color:clr.am},{label:'Not Accepting',value:ls.notAccepting,color:clr.rd}]}/></div>}
            {us&&<div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>User Roles Distribution</h3><Donut segments={Object.entries(us.roleMap).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([label,value],i)=>({label,value,color:[clr.ac,clr.gn,clr.pu,clr.am,clr.bl,clr.rd,'#f472b6','#a3e635'][i]}))}/></div>}
          </div>
        </TabsContent>
        <TabsContent value='listings'>
          {ls&&fls&&<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:14,marginBottom:24}}>
              <KPI label='eReferral Enabled' value={ls.eRefEnabled} sub={P(ls.eRefEnabled,ls.total)+'%'} color={clr.gn}/><KPI label='eConsult Enabled' value={ls.eConEnabled} sub={P(ls.eConEnabled,ls.total)+'%'} color={clr.pu}/><KPI label='In Test Mode' value={includeTest?ls.testMode:testCount} sub={includeTest?'not yet live':'excluded by filter'} color={includeTest?clr.am:clr.dm}/><KPI label='CC Enabled' value={ls.ccEnabled} sub={P(ls.ccEnabled,ls.total)+'%'} color={clr.bl}/><KPI label='Contributing' value={ls.contributing} sub={P(ls.contributing,ls.total)+'%'} color='#2dd4bf'/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Listing Type Breakdown</h3><Bar data={Object.entries(ls.typeMap).sort((a,b)=>b[1]-a[1]).map(([l,v])=>({label:l.replace(/_/g,' ').substring(0,22),value:v}))} color={clr.ac}/></div>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>eReferral vs eConsult</h3><Donut size={150} segments={[{label:'eReferral Only',value:ls.eRefEnabled-fls.filter(l=>l.eReferrals==='ENABLED'&&l.eConsults==='ENABLED').length,color:clr.gn},{label:'eConsult Only',value:ls.eConEnabled-fls.filter(l=>l.eReferrals==='ENABLED'&&l.eConsults==='ENABLED').length,color:clr.pu},{label:'Both',value:fls.filter(l=>l.eReferrals==='ENABLED'&&l.eConsults==='ENABLED').length,color:clr.ac},{label:'Neither',value:ls.total-ls.eRefEnabled-ls.eConEnabled+fls.filter(l=>l.eReferrals==='ENABLED'&&l.eConsults==='ENABLED').length,color:clr.rd}]}/></div>
            </div>
            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
              <h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Technical Readiness Scorecard</h3>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:20}}>
                {[{label:'Cloud Connect Enabled',n:ls.ccEnabled,t:ls.total,c:clr.ac},{label:'SEK Stored',n:ls.sekStored,t:ls.total,c:clr.pu},{label:'Repository Contributing',n:ls.contributing,t:ls.total,c:clr.gn}].map((it,i)=><div key={i} style={{textAlign:'center'}}><div style={{fontSize:32,fontWeight:800,color:it.c}}>{P(it.n,it.t)}%</div><Progress value={P(it.n,it.t)} style={{height:6,marginTop:8,background:clr.bd}}/><div style={{fontSize:12,color:clr.mu,marginTop:8}}>{it.label}</div><div style={{fontSize:11,color:clr.dm}}>{F(it.n)} / {F(it.t)}</div></div>)}
              </div>
            </div>
          </>}
        </TabsContent>
        <TabsContent value='onboarding'>
          {us&&<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
              <KPI label='Total Users Onboarded' value={us.total} color={clr.ac}/><KPI label='Currently Valid' value={us.valid} sub={P(us.valid,us.total)+'% retention'} color={clr.gn}/><KPI label='Earliest Agreement' value={us.timeline.length>0?us.timeline[0].label:'N/A'} color={clr.mu}/><KPI label='Latest Agreement' value={us.timeline.length>0?us.timeline[us.timeline.length-1].label:'N/A'} color={clr.ac}/>
            </div>
            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24,marginBottom:20}}>
              <h3 style={{fontSize:15,fontWeight:700,marginBottom:4,marginTop:0}}>Cumulative User Onboarding Over Time</h3>
              <p style={{fontSize:12,color:clr.dm,marginBottom:16,marginTop:0}}>Based on Date of Agreement</p>
              <Area data={us.timeline} color={clr.ac} height={240}/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Monthly New Users</h3><Bar data={us.timeline.slice(-24).map(d=>({label:d.label,value:d.value}))} color={clr.gn} height={180}/></div>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>Licence Agreement Versions</h3><Donut segments={Object.entries(us.versionMap).sort((a,b)=>b[1]-a[1]).map(([l,v],i)=>({label:l||'Unknown',value:v,color:[clr.ac,clr.gn,clr.pu,clr.am,clr.bl,clr.rd][i%6]}))}/></div>
            </div>
          </>}
        </TabsContent>
        <TabsContent value='geography'>
          {ls&&<>
            <div style={{display:'flex',alignItems:'center',gap:16,marginBottom:20}}>
              <span style={{fontSize:13,color:clr.mu}}>Group by:</span>
              <Select value={gf} onValueChange={(v:any)=>setGf(v)}>
                <SelectTrigger style={{width:200,background:clr.cd,border:'1px solid '+clr.bd,color:clr.tx}}><SelectValue/></SelectTrigger>
                <SelectContent><SelectItem value='province'>Province</SelectItem><SelectItem value='healthRegion'>Health Region</SelectItem><SelectItem value='city'>City</SelectItem></SelectContent>
              </Select>
            </div>
            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24,marginBottom:20}}>
              <h3 style={{fontSize:15,fontWeight:700,margin:0,marginBottom:16}}>eReferral Adoption by {gf==='healthRegion'?'Health Region':gf==='province'?'Province':'City'}</h3>
              <ScrollArea style={{maxHeight:500}}><Geo data={ls.geoData}/></ScrollArea>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:12,marginTop:0,color:clr.gn}}>Highest Adoption</h3>{ls.geoData.filter(d=>d.total>=2).sort((a,b)=>b.rate-a.rate).slice(0,8).map((d,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid '+clr.bd}}><span style={{fontSize:13,color:clr.tx}}>{d.region||'Unspecified'}</span><span style={{fontSize:13,fontWeight:700,color:clr.gn}}>{d.rate}% <span style={{fontWeight:400,color:clr.dm}}>({d.enabled}/{d.total})</span></span></div>)}</div>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:12,marginTop:0,color:clr.rd}}>Lowest Adoption</h3>{ls.geoData.filter(d=>d.total>=2).sort((a,b)=>a.rate-b.rate).slice(0,8).map((d,i)=><div key={i} style={{display:'flex',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid '+clr.bd}}><span style={{fontSize:13,color:clr.tx}}>{d.region||'Unspecified'}</span><span style={{fontSize:13,fontWeight:700,color:d.rate<30?clr.rd:clr.am}}>{d.rate}% <span style={{fontWeight:400,color:clr.dm}}>({d.enabled}/{d.total})</span></span></div>)}</div>
            </div>
          </>}
        </TabsContent>
        <TabsContent value='sites'>
          {ss&&<div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}><KPI label='Total Sites' value={ss.total} color={clr.ac}/><KPI label='Validated' value={ss.validated} sub={P(ss.validated,ss.total)+'%'} color={clr.gn}/><KPI label='Patient Messaging' value={ss.pmEnabled} sub={ss.totalPmLic+' licences'} color={clr.pu}/><KPI label='Online Booking' value={ss.obEnabled} sub={ss.totalObLic+' licences'} color={clr.bl}/></div>}
          {ss&&<div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24,marginBottom:20}}><h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>EMR Distribution</h3><Bar data={Object.entries(ss.emrMap).sort((a,b)=>b[1]-a[1]).map(([l,v])=>({label:l||'None',value:v}))} color={clr.pu} height={160}/></div>}
          {fm&&<div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:12}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <h3 style={{fontSize:15,fontWeight:700,margin:0}}>Site Maturity Detail</h3>
                <span style={{fontSize:12,color:clr.dm,background:clr.bd,padding:'2px 8px',borderRadius:10}}>{fm.length}{sq?' filtered':''} of {sm?.length} sites</span>
              </div>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <input type='text' placeholder='Search sites...' value={sq} onChange={e=>setSq(e.target.value)} style={{background:clr.bg,border:'1px solid '+clr.bd,borderRadius:6,padding:'7px 12px',color:clr.tx,fontSize:13,width:220,outline:'none'}}/>
                <button onClick={()=>{if(!fm)return;doExport(fm.map(s=>({'Site Number':s.siteNum,'Site Name':s.siteName,EMR:s.emr||'','Total Listings':s.total,'eReferral Enabled':s.eRefEnabled,'eConsult Enabled':s.eConEnabled,'CC Enabled':s.ccEnabled,'Adoption Rate %':s.adoptionRate,Users:s.userCount,Validated:s.validated?'TRUE':'FALSE'})),'site-maturity-'+new Date().toISOString().slice(0,10)+'.xlsx');}} style={{background:'linear-gradient(135deg,'+clr.ac+'22,'+clr.ac+'11)',border:'1px solid '+clr.ac+'44',borderRadius:6,padding:'7px 16px',color:clr.ac,fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Export to Excel</button>
              </div>
            </div>
            <div style={{maxHeight:600,overflowY:'auto',borderRadius:8,border:'1px solid '+clr.bd+'22'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead style={{position:'sticky',top:0,zIndex:2,background:clr.cd}}>
                  <tr style={{borderBottom:'2px solid '+clr.bd}}>
                    <th style={thS('siteNum')} onClick={()=>doSort('siteNum')}>Site #{sIco('siteNum')}</th>
                    <th style={thS('siteName')} onClick={()=>doSort('siteName')}>Site Name{sIco('siteName')}</th>
                    <th style={thS('emr')} onClick={()=>doSort('emr')}>EMR{sIco('emr')}</th>
                    <th style={thS('total')} onClick={()=>doSort('total')}>Listings{sIco('total')}</th>
                    <th style={thS('eRefEnabled')} onClick={()=>doSort('eRefEnabled')}>eRef{sIco('eRefEnabled')}</th>
                    <th style={thS('adoptionRate')} onClick={()=>doSort('adoptionRate')}>Adopt %{sIco('adoptionRate')}</th>
                    <th style={thS('userCount')} onClick={()=>doSort('userCount')}>Users{sIco('userCount')}</th>
                    <th style={thS('validated')} onClick={()=>doSort('validated')}>Valid{sIco('validated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {fm.map((s,i)=><tr key={i} style={{borderBottom:'1px solid '+clr.bd+'22'}} onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=clr.bd+'33';}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent';}}>
                    <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:clr.dm}}>{s.siteNum}</td>
                    <td style={{padding:'8px 10px',color:clr.tx,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.siteName}>{s.siteName}</td>
                    <td style={{padding:'8px 10px',color:clr.mu}}>{s.emr||'\u2014'}</td>
                    <td style={{padding:'8px 10px',color:clr.tx,fontWeight:600}}>{s.total}</td>
                    <td style={{padding:'8px 10px',color:clr.gn,fontWeight:600}}>{s.eRefEnabled}</td>
                    <td style={{padding:'8px 10px'}}><div style={{display:'flex',alignItems:'center',gap:6}}><div style={{width:50,height:6,background:clr.bd,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:s.adoptionRate+'%',background:s.adoptionRate>=70?clr.gn:s.adoptionRate>=40?clr.am:clr.rd,borderRadius:3}}/></div><span style={{fontWeight:600,color:s.adoptionRate>=70?clr.gn:s.adoptionRate>=40?clr.am:clr.rd}}>{s.adoptionRate}%</span></div></td>
                    <td style={{padding:'8px 10px',color:clr.ac,fontWeight:600}}>{s.userCount}</td>
                    <td style={{padding:'8px 10px'}}>{s.validated?<span style={{color:clr.gn}}>\u2713</span>:<span style={{color:clr.dm}}>\u2014</span>}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {fm.length===0&&<div style={{textAlign:'center',padding:'32px 0',color:clr.dm}}>No sites match your search.</div>}
          </div>}
        </TabsContent>
        <TabsContent value='staffing'>
          {fStaff&&listings&&<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
              <KPI label='Sites Analyzed' value={fStaff.length} color={clr.ac}/>
              <KPI label='Total Users' value={fStaff.reduce((s,r)=>s+r.userCount,0)} color={clr.bl}/>
              <KPI label='Total RA Clinicians' value={fStaff.reduce((s,r)=>s+r.raClinTotal,0)} sub='declared across all listings' color={clr.pu}/>
              <KPI label='Sites with Gap' value={fStaff.filter(s=>s.absDelta>0).length} sub={P(fStaff.filter(s=>s.absDelta>0).length,fStaff.length)+'% of sites'} color={clr.am}/>
            </div>
            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:12}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <h3 style={{fontSize:15,fontWeight:700,margin:0}}>Staffing Reconciliation</h3>
                  <span style={{fontSize:12,color:clr.dm,background:clr.bd,padding:'2px 8px',borderRadius:10}}>{fStaff.length}{stq?' filtered':''} of {staffing?.length} sites</span>
                </div>
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  <input type='text' placeholder='Search sites...' value={stq} onChange={e=>setStq(e.target.value)} style={{background:clr.bg,border:'1px solid '+clr.bd,borderRadius:6,padding:'7px 12px',color:clr.tx,fontSize:13,width:220,outline:'none'}}/>
                  <button onClick={()=>{if(!fStaff)return;doExport(fStaff.map(s=>({'Site Number':s.siteNum,'Site Name':s.siteName,Users:s.userCount,'RA Clinicians Declared':s.raClinTotal,Delta:s.delta,'Abs Gap':s.absDelta,Listings:s.listingCount})),'staffing-reconciliation-'+new Date().toISOString().slice(0,10)+'.xlsx');}} style={{background:'linear-gradient(135deg,'+clr.ac+'22,'+clr.ac+'11)',border:'1px solid '+clr.ac+'44',borderRadius:6,padding:'7px 16px',color:clr.ac,fontSize:12,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Export to Excel</button>
                </div>
              </div>
              <div style={{fontSize:12,color:clr.mu,marginBottom:16,display:'flex',gap:20,flexWrap:'wrap'}}>
                <span><strong style={{color:clr.tx}}>Users</strong> = Ocean accounts linked to site</span>
                <span><strong style={{color:clr.tx}}>RA Clinicians</strong> = declared authorized clinicians across listings</span>
                <span><strong style={{color:clr.tx}}>Delta</strong> = Users minus RA Clinicians (positive = more users than declared)</span>
              </div>
              <div style={{maxHeight:650,overflowY:'auto',borderRadius:8,border:'1px solid '+clr.bd+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:clr.cd}}>
                    <tr style={{borderBottom:'2px solid '+clr.bd}}>
                      <th style={{...stTh('_'),width:30,cursor:'default'}}></th>
                      <th style={stTh('siteNum')} onClick={()=>doStSort('siteNum')}>Site #{stIco('siteNum')}</th>
                      <th style={stTh('siteName')} onClick={()=>doStSort('siteName')}>Site Name{stIco('siteName')}</th>
                      <th style={stTh('userCount')} onClick={()=>doStSort('userCount')}>Users{stIco('userCount')}</th>
                      <th style={stTh('raClinTotal')} onClick={()=>doStSort('raClinTotal')}>RA Clinicians{stIco('raClinTotal')}</th>
                      <th style={stTh('delta')} onClick={()=>doStSort('delta')}>Delta{stIco('delta')}</th>
                      <th style={stTh('absDelta')} onClick={()=>doStSort('absDelta')}>Gap{stIco('absDelta')}</th>
                      <th style={stTh('listingCount')} onClick={()=>doStSort('listingCount')}>Listings{stIco('listingCount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fStaff.map((s,i)=>{const isExp=expandedSite===s.siteNum;return(<>
                      <tr key={'r'+i} style={{borderBottom:'1px solid '+clr.bd+'22',cursor:'pointer',background:isExp?clr.bd+'44':'transparent'}} onClick={()=>setExpandedSite(isExp?null:s.siteNum)} onMouseEnter={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background=clr.bd+'33';}} onMouseLeave={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background='transparent';}}>
                        <td style={{padding:'8px 6px',textAlign:'center',fontSize:14,color:clr.dm,transition:'transform 0.2s',transform:isExp?'rotate(90deg)':'rotate(0deg)'}}>&#9656;</td>
                        <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:clr.dm}}>{s.siteNum}</td>
                        <td style={{padding:'8px 10px',color:clr.tx,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.siteName}>{s.siteName}</td>
                        <td style={{padding:'8px 10px',color:clr.bl,fontWeight:600}}>{s.userCount}</td>
                        <td style={{padding:'8px 10px',color:clr.pu,fontWeight:600}}>{s.raClinTotal}</td>
                        <td style={{padding:'8px 10px',fontWeight:700,color:deltaColor(s.delta,s.raClinTotal)}}>{s.delta>0?'+':''}{s.delta}</td>
                        <td style={{padding:'8px 10px'}}><div style={{display:'flex',alignItems:'center',gap:6}}>
                          <div style={{width:40,height:6,background:clr.bd,borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:Math.min(s.absDelta/(Math.max(s.raClinTotal,s.userCount,1))*100,100)+'%',background:deltaColor(s.delta,s.raClinTotal),borderRadius:3}}/></div>
                          <span style={{fontWeight:600,color:deltaColor(s.delta,s.raClinTotal)}}>{s.absDelta}</span>
                        </div></td>
                        <td style={{padding:'8px 10px',color:clr.tx}}>{s.listingCount}</td>
                      </tr>
                      {isExp&&s.details.length>0&&<tr key={'d'+i}><td colSpan={8} style={{padding:0}}>
                        <div style={{background:clr.bg,borderTop:'1px solid '+clr.bd,borderBottom:'1px solid '+clr.bd,padding:'12px 20px 12px 46px'}}>
                          <div style={{fontSize:11,color:clr.dm,fontWeight:700,textTransform:'uppercase',marginBottom:8,letterSpacing:0.5}}>Listings for {s.siteName}</div>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                            <thead><tr style={{borderBottom:'1px solid '+clr.bd}}>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Ref</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Listing Title</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Type</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>RA Clinicians</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>eReferral</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>eConsult</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Claimed By</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Clinician Prof ID</th>
                            </tr></thead>
                            <tbody>{s.details.map((d,j)=><tr key={j} style={{borderBottom:'1px solid '+clr.bd+'22'}}>
                              <td style={{padding:'5px 8px',fontFamily:"'JetBrains Mono'",color:clr.dm}}>{d.ref}</td>
                              <td style={{padding:'5px 8px',color:clr.tx,maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={d.title}>{d.title}</td>
                              <td style={{padding:'5px 8px',color:clr.mu}}>{(d.listingType||'').replace(/_/g,' ')}</td>
                              <td style={{padding:'5px 8px',fontWeight:700,color:d.raClinCount>0?clr.pu:clr.dm}}>{d.raClinCount}</td>
                              <td style={{padding:'5px 8px'}}><span style={{padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:d.eReferrals==='ENABLED'?clr.gn+'22':clr.rd+'22',color:d.eReferrals==='ENABLED'?clr.gn:clr.rd}}>{d.eReferrals==='ENABLED'?'ON':'OFF'}</span></td>
                              <td style={{padding:'5px 8px'}}><span style={{padding:'2px 6px',borderRadius:4,fontSize:10,fontWeight:600,background:d.eConsults==='ENABLED'?clr.pu+'22':clr.bd,color:d.eConsults==='ENABLED'?clr.pu:clr.dm}}>{d.eConsults==='ENABLED'?'ON':'OFF'}</span></td>
                              <td style={{padding:'5px 8px',color:d.claimedByUser?clr.tx:clr.dm,fontStyle:d.claimedByUser?'normal':'italic'}}>{d.claimedByUser||'unclaimed'}</td>
                              <td style={{padding:'5px 8px',fontFamily:"'JetBrains Mono'",color:d.clinicianProfId?clr.tx:clr.dm,fontStyle:d.clinicianProfId?'normal':'italic'}}>{d.clinicianProfId||'\u2014'}</td>
                            </tr>)}</tbody>
                          </table>
                          <div style={{marginTop:8,fontSize:11,color:clr.mu}}>Site total: <strong style={{color:clr.pu}}>{s.raClinTotal}</strong> RA clinicians across <strong style={{color:clr.tx}}>{s.listingCount}</strong> listings | <strong style={{color:clr.bl}}>{s.userCount}</strong> Ocean users linked</div>
                        </div>
                      </td></tr>}
                    </>);})}
                  </tbody>
                </table>
              </div>
              {fStaff.length===0&&<div style={{textAlign:'center',padding:'32px 0',color:clr.dm}}>No sites match your search.</div>}
            </div>
          </>}
        </TabsContent>
        <TabsContent value='referrals'>
          {ra&&fRa?<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:14}}>
              <KPI label='Total Referrals (All Time)' value={ra.distinctRefs} sub={ra.distinctRefs!==ra.total?ra.total+' rows':'distinct referral IDs'} color={clr.ac}/>
              <KPI label='Unique Senders' value={ra.uniqueProfIds} sub={ra.uniqueSenders+' usernames'} color={clr.gn}/>
              <KPI label='Unique Receivers' value={ra.uniqueTargetRefs} sub='distinct target listings' color={clr.pu}/>
              <KPI label='Unique Sending Sites' value={ra.uniqueSendingSites} sub={ra.uniqueTargetSites+' target sites'} color={clr.bl}/>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
              <KPI label={'Current Month ('+ra.curM+')'} value={F(ra.curMCount)} sub='partial month in progress' color={clr.ac}/>
              <KPI label={'1 Month Change'} value={ra.chg1.val} sub={ra.chg1.val==='N/A'?'No data for '+ra.cmp1M+(ra.earliestDate?'. Data starts '+ra.earliestDate:''):ra.lastFullM+' ('+F(ra.lastFullCount)+') vs '+ra.cmp1M+' ('+F(ra.cmp1Count)+')'} color={ra.chg1.val==='N/A'?clr.dm:ra.chg1.num>=0?clr.gn:clr.rd}/>
              <KPI label={'3 Month Change'} value={ra.chg3.val} sub={ra.chg3.val==='N/A'?'No data for '+ra.cmp3M+(ra.earliestDate?'. Data starts '+ra.earliestDate:''):ra.lastFullM+' ('+F(ra.lastFullCount)+') vs '+ra.cmp3M+' ('+F(ra.cmp3Count)+')'} color={ra.chg3.val==='N/A'?clr.dm:ra.chg3.num>=0?clr.gn:clr.rd}/>
              <KPI label={'12 Month Change'} value={ra.chg12.val} sub={ra.chg12.val==='N/A'?'No data for '+ra.cmp12M+(ra.earliestDate?'. Data starts '+ra.earliestDate:''):ra.lastFullM+' ('+F(ra.lastFullCount)+') vs '+ra.cmp12M+' ('+F(ra.cmp12Count)+')'} color={ra.chg12.val==='N/A'?clr.dm:ra.chg12.num>=0?clr.gn:clr.rd}/>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <h3 style={{fontSize:15,fontWeight:700,marginBottom:4,marginTop:0}}>Cumulative Referral Volume</h3>
                <p style={{fontSize:12,color:clr.dm,marginBottom:12,marginTop:0}}>Based on referral creation date</p>
                <Area data={ra.timeline} color={clr.ac} height={200}/>
              </div>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <h3 style={{fontSize:15,fontWeight:700,marginBottom:4,marginTop:0}}>Monthly Referral Volume</h3>
                <p style={{fontSize:12,color:clr.dm,marginBottom:12,marginTop:0}}>Referrals created per month</p>
                <Bar data={ra.timeline.slice(-24).map(d=>({label:d.label,value:d.value}))} color={clr.gn} height={200}/>
              </div>
            </div>

            {ra.weekly.length>0&&<div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16,marginBottom:20}}>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:4,marginTop:0}}>Referrals Per Week</h3>
                <p style={{fontSize:11,color:clr.dm,marginBottom:8,marginTop:0}}>Test (amber) vs non-test (green)</p>
                <MiniBar data={ra.weekly.slice(-26).map(w=>({label:w.label,primary:w.nonTest,secondary:w.test}))} color={clr.gn} stacked/>
              </div>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:4,marginTop:0}}>Unique Senders Per Week</h3>
                <p style={{fontSize:11,color:clr.dm,marginBottom:8,marginTop:0}}>Distinct professional IDs, excl. test</p>
                <MiniBar data={ra.weekly.slice(-26).map(w=>({label:w.label,primary:w.senders}))} color={clr.bl}/>
              </div>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:4,marginTop:0}}>Unique Receivers Per Week</h3>
                <p style={{fontSize:11,color:clr.dm,marginBottom:8,marginTop:0}}>Distinct target listing refs, excl. test</p>
                <MiniBar data={ra.weekly.slice(-26).map(w=>({label:w.label,primary:w.receivers}))} color={clr.pu}/>
              </div>
            </div>}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:20}}>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:12,marginTop:0}}>Target Region</h3>
                <Donut size={140} segments={ra.byRegion.map((d,i)=>({label:d.label,value:d.value,color:d.label==='Referrals not mapped to listings'?clr.rd:d.label==='Region not defined'?clr.am:[clr.ac,clr.gn,clr.pu,clr.bl,'#f472b6','#a3e635','#fb923c','#6ee7b7',clr.rd,clr.am,'#94A3B8'][i%11]}))}/>
              </div>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:12,marginTop:0}}>Referral Categories</h3>
                <Donut size={140} segments={ra.byService.map((d,i)=>({label:d.label.replace(/_/g,' ').substring(0,25),value:d.value,color:[clr.gn,clr.ac,clr.pu,clr.am,clr.bl,clr.rd,'#f472b6','#a3e635','#fb923c','#6ee7b7','#94A3B8'][i%11]}))}/>
              </div>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:12,marginTop:0}}>Referrer Clinician Type</h3>
                <Donut size={140} segments={ra.byClinType.map((d,i)=>({label:d.label.replace(/_/g,' ').substring(0,25),value:d.value,color:[clr.bl,clr.gn,clr.pu,clr.am,clr.ac,clr.rd,'#f472b6','#a3e635','#fb923c','#6ee7b7','#94A3B8'][i%11]}))}/>
              </div>
            </div>

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <h3 style={{fontSize:14,fontWeight:700,marginBottom:12,marginTop:0}}>Referrals Sent — EMR Breakdown</h3>
                <Bar data={ra.byEmrSent.slice(0,10)} color={clr.bl} height={180}/>
              </div>
              <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                  <h3 style={{fontSize:14,fontWeight:700,margin:0}}>Referrals Received — EMR Breakdown</h3>
                  {ra.fhirCount>0&&<span style={{fontSize:11,padding:'3px 8px',borderRadius:4,background:clr.ac+'22',color:clr.ac,fontWeight:600}}>FHIR/API: {ra.fhirPct}% ({F(ra.fhirCount)})</span>}
                </div>
                <Bar data={ra.byEmrRecv.slice(0,10)} color={clr.pu} height={180}/>
              </div>
            </div>

            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:12}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  {([['target','By Target Site',clr.pu],['source','By Source Site',clr.bl],['sender','By Sender',clr.gn]] as [string,string,string][]).map(([val,lbl,c])=>
                    <button key={val} onClick={()=>{setRtSec(val as any);setRtq('');setRtf('totalRefs');setRtd('desc');setRtExpanded(null);}} style={{fontSize:12,padding:'6px 14px',borderRadius:6,background:rtSec===val?c+'22':'transparent',color:rtSec===val?c:clr.dm,border:'1px solid '+(rtSec===val?c+'66':clr.bd),fontWeight:600,cursor:'pointer'}}>{lbl}</button>
                  )}
                </div>
                <div style={{display:'flex',gap:10,alignItems:'center'}}>
                  <input type='text' placeholder='Search...' value={rtq} onChange={e=>setRtq(e.target.value)} style={{background:clr.bg,border:'1px solid '+clr.bd,borderRadius:6,padding:'7px 12px',color:clr.tx,fontSize:13,width:200,outline:'none'}}/>
                  <span style={{fontSize:12,color:clr.dm,background:clr.bd,padding:'2px 8px',borderRadius:10}}>{fRa.length} results</span>
                </div>
              </div>
              {rtSec==='target'&&<div style={{maxHeight:600,overflowY:'auto',borderRadius:8,border:'1px solid '+clr.bd+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:clr.cd}}>
                    <tr style={{borderBottom:'2px solid '+clr.bd}}>
                      <th style={{...rtTh('_'),width:30,cursor:'default'}}></th>
                      <th style={rtTh('siteNum')} onClick={()=>doRtSort('siteNum')}>Site #{rtIco('siteNum')}</th>
                      <th style={rtTh('siteName')} onClick={()=>doRtSort('siteName')}>Site Name{rtIco('siteName')}</th>
                      <th style={rtTh('totalRefs')} onClick={()=>doRtSort('totalRefs')}>Referrals{rtIco('totalRefs')}</th>
                      <th style={rtTh('uniqueSenders')} onClick={()=>doRtSort('uniqueSenders')}>Unique Senders{rtIco('uniqueSenders')}</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>State Breakdown</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fRa as any[]).map((s:any,i:number)=>{const isExp=rtExpanded===s.siteNum;return(<>
                      <tr key={'r'+i} style={{borderBottom:'1px solid '+clr.bd+'22',cursor:'pointer',background:isExp?clr.bd+'44':'transparent'}} onClick={()=>setRtExpanded(isExp?null:s.siteNum)} onMouseEnter={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background=clr.bd+'33';}} onMouseLeave={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background='transparent';}}>
                        <td style={{padding:'8px 6px',textAlign:'center',fontSize:14,color:clr.dm,transition:'transform 0.2s',transform:isExp?'rotate(90deg)':'rotate(0deg)'}}>&#9656;</td>
                        <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:clr.dm}}>{s.siteNum}</td>
                        <td style={{padding:'8px 10px',color:clr.tx,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.siteName}>{s.siteName}</td>
                        <td style={{padding:'8px 10px',color:clr.pu,fontWeight:700}}>{F(s.totalRefs)}</td>
                        <td style={{padding:'8px 10px',color:clr.bl,fontWeight:600}}>{s.uniqueSenders}</td>
                        <td style={{padding:'8px 10px'}}><div style={{display:'flex',gap:4,flexWrap:'wrap'}}>{Object.entries(s.states).sort((a:any,b:any)=>b[1]-a[1]).slice(0,5).map(([st,ct]:any)=><span key={st} style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:st==='COMPLETE'||st==='ACCEPTED'?clr.gn+'22':st==='CANCELLED'||st==='DECLINED'?clr.rd+'22':clr.bd,color:st==='COMPLETE'||st==='ACCEPTED'?clr.gn:st==='CANCELLED'||st==='DECLINED'?clr.rd:clr.mu,fontWeight:600}}>{st} {ct}</span>)}</div></td>
                      </tr>
                      {isExp&&s.listings.length>0&&<tr key={'d'+i}><td colSpan={6} style={{padding:0}}>
                        <div style={{background:clr.bg,borderTop:'1px solid '+clr.bd,borderBottom:'1px solid '+clr.bd,padding:'12px 20px 12px 46px'}}>
                          <div style={{fontSize:11,color:clr.dm,fontWeight:700,textTransform:'uppercase',marginBottom:8,letterSpacing:0.5}}>Listings receiving referrals at {s.siteName}</div>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                            <thead><tr style={{borderBottom:'1px solid '+clr.bd}}>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Listing Ref</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Listing Title</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Referrals</th>
                            </tr></thead>
                            <tbody>{s.listings.map((l:any,j:number)=><tr key={j} style={{borderBottom:'1px solid '+clr.bd+'22'}}>
                              <td style={{padding:'5px 8px',fontFamily:"'JetBrains Mono'",color:clr.dm,fontSize:10}}>{l.ref}</td>
                              <td style={{padding:'5px 8px',color:clr.tx,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={l.title}>{l.title}</td>
                              <td style={{padding:'5px 8px',color:clr.pu,fontWeight:700}}>{F(l.count)}</td>
                            </tr>)}</tbody>
                          </table>
                        </div>
                      </td></tr>}
                    </>);})}
                  </tbody>
                </table>
              </div>}
              {rtSec==='source'&&<div style={{maxHeight:600,overflowY:'auto',borderRadius:8,border:'1px solid '+clr.bd+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:clr.cd}}>
                    <tr style={{borderBottom:'2px solid '+clr.bd}}>
                      <th style={rtTh('siteNum')} onClick={()=>doRtSort('siteNum')}>Site #{rtIco('siteNum')}</th>
                      <th style={rtTh('siteName')} onClick={()=>doRtSort('siteName')}>Site Name{rtIco('siteName')}</th>
                      <th style={rtTh('totalRefs')} onClick={()=>doRtSort('totalRefs')}>Referrals Sent{rtIco('totalRefs')}</th>
                      <th style={rtTh('uniqueTargets')} onClick={()=>doRtSort('uniqueTargets')}>Target Sites{rtIco('uniqueTargets')}</th>
                      <th style={rtTh('uniqueUsers')} onClick={()=>doRtSort('uniqueUsers')}>Unique Users{rtIco('uniqueUsers')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fRa as any[]).map((s:any,i:number)=><tr key={i} style={{borderBottom:'1px solid '+clr.bd+'22'}} onMouseEnter={e=>{(e.currentTarget as HTMLElement).style.background=clr.bd+'33';}} onMouseLeave={e=>{(e.currentTarget as HTMLElement).style.background='transparent';}}>
                      <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:clr.dm}}>{s.siteNum}</td>
                      <td style={{padding:'8px 10px',color:clr.tx,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.siteName}>{s.siteName}</td>
                      <td style={{padding:'8px 10px',color:clr.bl,fontWeight:700}}>{F(s.totalRefs)}</td>
                      <td style={{padding:'8px 10px',color:clr.pu,fontWeight:600}}>{s.uniqueTargets}</td>
                      <td style={{padding:'8px 10px',color:clr.gn,fontWeight:600}}>{s.uniqueUsers}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>}
              {rtSec==='sender'&&<div style={{maxHeight:600,overflowY:'auto',borderRadius:8,border:'1px solid '+clr.bd+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:clr.cd}}>
                    <tr style={{borderBottom:'2px solid '+clr.bd}}>
                      <th style={{...rtTh('_'),width:30,cursor:'default'}}></th>
                      <th style={rtTh('userName')} onClick={()=>doRtSort('userName')}>Username{rtIco('userName')}</th>
                      <th style={rtTh('fullName')} onClick={()=>doRtSort('fullName')}>Full Name{rtIco('fullName')}</th>
                      <th style={rtTh('clinicianType')} onClick={()=>doRtSort('clinicianType')}>Clinician Type{rtIco('clinicianType')}</th>
                      <th style={rtTh('profId')} onClick={()=>doRtSort('profId')}>Professional ID{rtIco('profId')}</th>
                      <th style={rtTh('totalRefs')} onClick={()=>doRtSort('totalRefs')}>Referrals Sent{rtIco('totalRefs')}</th>
                      <th style={rtTh('uniqueTargets')} onClick={()=>doRtSort('uniqueTargets')}>Target Sites{rtIco('uniqueTargets')}</th>
                      <th style={rtTh('uniqueListings')} onClick={()=>doRtSort('uniqueListings')}>Target Listings{rtIco('uniqueListings')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(fRa as any[]).map((s:any,i:number)=>{const rowKey=s.isUnknown?'__unknown__':s.userName;const isExp=rtExpanded===rowKey;return(<>
                      <tr key={'r'+i} style={{borderBottom:s.isUnknown&&!isExp?'2px solid '+clr.am+'44':'1px solid '+clr.bd+'22',cursor:'pointer',background:isExp?clr.bd+'44':s.isUnknown?clr.am+'11':'transparent'}} onClick={()=>setRtExpanded(isExp?null:rowKey)} onMouseEnter={e=>{if(!isExp&&!s.isUnknown)(e.currentTarget as HTMLElement).style.background=clr.bd+'33';}} onMouseLeave={e=>{if(!isExp)(e.currentTarget as HTMLElement).style.background=s.isUnknown?clr.am+'11':'transparent';}}>
                        <td style={{padding:'8px 6px',textAlign:'center',fontSize:14,color:s.isUnknown?clr.am:clr.dm,transition:'transform 0.2s',transform:isExp?'rotate(90deg)':'rotate(0deg)'}}>&#9656;</td>
                        <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:s.isUnknown?clr.am:clr.dm,fontStyle:s.isUnknown?'italic':'normal'}}>{s.isUnknown?'\u2014':s.userName}</td>
                        <td style={{padding:'8px 10px',color:s.isUnknown?clr.am:clr.tx,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontStyle:s.isUnknown?'italic':'normal',fontWeight:s.isUnknown?600:400}} title={s.fullName}>{s.fullName}</td>
                        <td style={{padding:'8px 10px',color:clr.mu}}>{s.clinicianType||'\u2014'}</td>
                        <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:s.profId?clr.tx:clr.dm,fontStyle:s.profId?'normal':'italic'}}>{s.profId||'\u2014'}</td>
                        <td style={{padding:'8px 10px',color:s.isUnknown?clr.am:clr.gn,fontWeight:700}}>{F(s.totalRefs)}</td>
                        <td style={{padding:'8px 10px',color:clr.pu,fontWeight:600}}>{s.uniqueTargets}</td>
                        <td style={{padding:'8px 10px',color:clr.ac,fontWeight:600}}>{s.uniqueListings}</td>
                      </tr>
                      {isExp&&s.srcSites&&s.srcSites.length>0&&<tr key={'d'+i}><td colSpan={8} style={{padding:0}}>
                        <div style={{background:clr.bg,borderTop:'1px solid '+clr.bd,borderBottom:s.isUnknown?'2px solid '+clr.am+'44':'1px solid '+clr.bd,padding:'12px 20px 12px 46px'}}>
                          <div style={{fontSize:11,color:clr.dm,fontWeight:700,textTransform:'uppercase',marginBottom:8,letterSpacing:0.5}}>Sending sites for {s.isUnknown?'unknown senders':s.fullName}</div>
                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                            <thead><tr style={{borderBottom:'1px solid '+clr.bd}}>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Site Number</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Site Name</th>
                              <th style={{padding:'6px 8px',textAlign:'left',color:clr.dm,fontWeight:600}}>Referrals Sent</th>
                            </tr></thead>
                            <tbody>{s.srcSites.map((ss:any,j:number)=><tr key={j} style={{borderBottom:'1px solid '+clr.bd+'22'}}>
                              <td style={{padding:'5px 8px',fontFamily:"'JetBrains Mono'",color:clr.dm}}>{ss.siteNum}</td>
                              <td style={{padding:'5px 8px',color:clr.tx,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={ss.siteName}>{ss.siteName}</td>
                              <td style={{padding:'5px 8px',color:clr.bl,fontWeight:700}}>{F(ss.count)}</td>
                            </tr>)}</tbody>
                          </table>
                          <div style={{marginTop:8,fontSize:11,color:clr.mu}}>{s.isUnknown?'Unknown senders':s.fullName} sent from <strong style={{color:clr.tx}}>{s.srcSites.length}</strong> site{s.srcSites.length!==1?'s':''} — <strong style={{color:s.isUnknown?clr.am:clr.gn}}>{F(s.totalRefs)}</strong> total referrals</div>
                        </div>
                      </td></tr>}
                      {isExp&&(!s.srcSites||s.srcSites.length===0)&&<tr key={'d'+i}><td colSpan={8} style={{padding:0}}>
                        <div style={{background:clr.bg,borderTop:'1px solid '+clr.bd,borderBottom:'1px solid '+clr.bd,padding:'16px 46px',fontSize:12,color:clr.dm,fontStyle:'italic'}}>No source site information available for these referrals.</div>
                      </td></tr>}
                    </>);})}
                  </tbody>
                </table>
              </div>}
              {fRa.length===0&&<div style={{textAlign:'center',padding:'32px 0',color:clr.dm}}>No results match your search.</div>}
            </div>
          </>:<div style={{textAlign:'center',padding:'40px 0',color:clr.dm}}>{referrals?'Load Listings, Sites, and Users files alongside Referral Analytics for full cross-referencing.':'Load the Referral Analytics export file to view referral activity.'}</div>}
        </TabsContent>
        <TabsContent value='dataquality'>
          {dq&&<>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:24}}>
              <KPI label='Unmatched User Links' value={dq.coverage.userToSite.linksOrphaned} sub={P(dq.coverage.userToSite.linksOrphaned,dq.coverage.userToSite.linksTotal)+'% of all user-site links'} color={clr.rd}/>
              <KPI label='Orphaned Site Numbers' value={dq.orphanedSNs.length} sub='not in Sites extract' color={clr.am}/>
              <KPI label='Blank Site Users' value={dq.blankUsers.length} sub='no site number assigned' color={clr.am}/>
              <KPI label='Join Health' value={P(dq.coverage.userToSite.linksMatched,dq.coverage.userToSite.linksTotal)+'%'} sub={dq.coverage.userToSite.linksMatched+' of '+dq.coverage.userToSite.linksTotal+' links resolve'} color={dq.coverage.userToSite.linksMatched/Math.max(dq.coverage.userToSite.linksTotal,1)>=0.9?clr.gn:dq.coverage.userToSite.linksMatched/Math.max(dq.coverage.userToSite.linksTotal,1)>=0.7?clr.am:clr.rd}/>
            </div>

            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24,marginBottom:20}}>
              <h3 style={{fontSize:15,fontWeight:700,marginBottom:16,marginTop:0}}>1. Cross-File Join Coverage Matrix</h3>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:16}}>
                <div style={{background:clr.bg,borderRadius:8,border:'1px solid '+clr.bd,padding:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:clr.ac,marginBottom:12,textTransform:'uppercase',letterSpacing:0.5}}>Users \u2192 Sites</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Unique site numbers in Users</span><span style={{color:clr.tx,fontWeight:600}}>{dq.coverage.userToSite.uniqueSNs}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Matched in Sites file</span><span style={{color:clr.gn,fontWeight:600}}>{dq.coverage.userToSite.matched}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Not found in Sites</span><span style={{color:clr.rd,fontWeight:600}}>{dq.coverage.userToSite.orphaned}</span></div>
                    <div style={{height:1,background:clr.bd,margin:'4px 0'}}/>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>User-site links (total)</span><span style={{color:clr.tx,fontWeight:600}}>{F(dq.coverage.userToSite.linksTotal)}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Links resolved</span><span style={{color:clr.gn,fontWeight:600}}>{F(dq.coverage.userToSite.linksMatched)}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Links orphaned</span><span style={{color:clr.rd,fontWeight:600}}>{F(dq.coverage.userToSite.linksOrphaned)}</span></div>
                    <Progress value={P(dq.coverage.userToSite.linksMatched,dq.coverage.userToSite.linksTotal)} style={{height:6,marginTop:4,background:clr.bd}}/>
                    <div style={{fontSize:11,color:clr.dm,textAlign:'center'}}>{P(dq.coverage.userToSite.linksMatched,dq.coverage.userToSite.linksTotal)}% coverage</div>
                  </div>
                </div>
                <div style={{background:clr.bg,borderRadius:8,border:'1px solid '+clr.bd,padding:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:clr.pu,marginBottom:12,textTransform:'uppercase',letterSpacing:0.5}}>Listings \u2192 Sites</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Unique site numbers in Listings</span><span style={{color:clr.tx,fontWeight:600}}>{dq.coverage.listingToSite.uniqueSNs}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Matched in Sites file</span><span style={{color:clr.gn,fontWeight:600}}>{dq.coverage.listingToSite.matched}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Not found in Sites</span><span style={{color:clr.rd,fontWeight:600}}>{dq.coverage.listingToSite.orphaned}</span></div>
                    <div style={{height:1,background:clr.bd,margin:'4px 0'}}/>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Listing rows matched</span><span style={{color:clr.gn,fontWeight:600}}>{F(dq.coverage.listingToSite.linksMatched)}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>Listing rows orphaned</span><span style={{color:clr.rd,fontWeight:600}}>{F(dq.coverage.listingToSite.linksOrphaned)}</span></div>
                    <Progress value={P(dq.coverage.listingToSite.linksMatched,dq.coverage.listingToSite.linksMatched+dq.coverage.listingToSite.linksOrphaned)} style={{height:6,marginTop:4,background:clr.bd}}/>
                    <div style={{fontSize:11,color:clr.dm,textAlign:'center'}}>{P(dq.coverage.listingToSite.linksMatched,dq.coverage.listingToSite.linksMatched+dq.coverage.listingToSite.linksOrphaned)}% coverage</div>
                  </div>
                </div>
                <div style={{background:clr.bg,borderRadius:8,border:'1px solid '+clr.bd,padding:16}}>
                  <div style={{fontSize:12,fontWeight:700,color:clr.gn,marginBottom:12,textTransform:'uppercase',letterSpacing:0.5}}>Users \u2192 Listings</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>User site #s also in Listings</span><span style={{color:clr.gn,fontWeight:600}}>{dq.coverage.userToListing.inListings}</span></div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}><span style={{color:clr.mu}}>User site #s not in Listings</span><span style={{color:clr.am,fontWeight:600}}>{dq.coverage.userToListing.notInListings}</span></div>
                    <div style={{height:1,background:clr.bd,margin:'4px 0'}}/>
                    <div style={{fontSize:11,color:clr.mu,lineHeight:1.5}}>Shows how many unique site numbers from the Users file also appear as a siteNum on at least one listing</div>
                    <Progress value={P(dq.coverage.userToListing.inListings,dq.coverage.userToListing.inListings+dq.coverage.userToListing.notInListings)} style={{height:6,marginTop:4,background:clr.bd}}/>
                    <div style={{fontSize:11,color:clr.dm,textAlign:'center'}}>{P(dq.coverage.userToListing.inListings,dq.coverage.userToListing.inListings+dq.coverage.userToListing.notInListings)}% overlap</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24,marginBottom:20}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,margin:0}}>2. Orphaned Users</h3>
                  <p style={{fontSize:12,color:clr.dm,margin:'4px 0 0'}}>Users whose site numbers do not appear in the Sites extract ({dq.orphanedUsers.length} fully orphaned, {dq.partialOrphanUsers} partially orphaned)</p>
                </div>
              </div>
              {dq.orphanedUsers.length>0?<div style={{maxHeight:400,overflowY:'auto',borderRadius:8,border:'1px solid '+clr.bd+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:clr.cd}}>
                    <tr style={{borderBottom:'2px solid '+clr.bd}}>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>User Name</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Clinician Type</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Site Numbers (raw)</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Date of Agreement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dq.orphanedUsers.map((u,i)=><tr key={i} style={{borderBottom:'1px solid '+clr.bd+'22'}}>
                      <td style={{padding:'8px 10px',color:clr.tx}}>{u.name}</td>
                      <td style={{padding:'8px 10px',color:clr.mu}}>{u.clinicianType||'\u2014'}</td>
                      <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:clr.rd,fontSize:11}}>{u.siteNumbers}</td>
                      <td style={{padding:'8px 10px',color:clr.mu}}>{u.dateOfAgreement||'\u2014'}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>:<div style={{textAlign:'center',padding:'24px 0',color:clr.gn,fontSize:13}}>All users have at least one site number that matches the Sites extract.</div>}
            </div>

            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24,marginBottom:20}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,margin:0}}>3. Orphaned Site Numbers Inventory</h3>
                  <p style={{fontSize:12,color:clr.dm,margin:'4px 0 0'}}>Site numbers appearing in Users or Listings but not in the Sites extract ({dq.orphanedSNs.length} found)</p>
                </div>
              </div>
              {dq.orphanedSNs.length>0?<div style={{maxHeight:400,overflowY:'auto',borderRadius:8,border:'1px solid '+clr.bd+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:clr.cd}}>
                    <tr style={{borderBottom:'2px solid '+clr.bd}}>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Site Number</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Users Referencing</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Listings Referencing</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Sample Users</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dq.orphanedSNs.map((s,i)=><tr key={i} style={{borderBottom:'1px solid '+clr.bd+'22'}}>
                      <td style={{padding:'8px 10px',fontFamily:"'JetBrains Mono'",color:clr.am,fontWeight:600}}>{s.siteNumber}</td>
                      <td style={{padding:'8px 10px',color:s.userCount>0?clr.bl:clr.dm,fontWeight:600}}>{s.userCount}</td>
                      <td style={{padding:'8px 10px',color:s.listingCount>0?clr.pu:clr.dm,fontWeight:600}}>{s.listingCount}</td>
                      <td style={{padding:'8px 10px',color:clr.mu,fontSize:11,maxWidth:300,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={s.sampleUsers.join(', ')}>{s.sampleUsers.join(', ')||'\u2014'}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>:<div style={{textAlign:'center',padding:'24px 0',color:clr.gn,fontSize:13}}>All site numbers in Users and Listings exist in the Sites extract.</div>}
            </div>

            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                <div>
                  <h3 style={{fontSize:15,fontWeight:700,margin:0}}>4. Users with Blank Site Numbers</h3>
                  <p style={{fontSize:12,color:clr.dm,margin:'4px 0 0'}}>{dq.blankUsers.length} users have no site number assigned</p>
                </div>
              </div>
              {dq.blankUsers.length>0?<div style={{maxHeight:350,overflowY:'auto',borderRadius:8,border:'1px solid '+clr.bd+'22'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead style={{position:'sticky',top:0,zIndex:2,background:clr.cd}}>
                    <tr style={{borderBottom:'2px solid '+clr.bd}}>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>User Name</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Clinician Type</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Email</th>
                      <th style={{padding:'10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:11,textTransform:'uppercase'}}>Date of Agreement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dq.blankUsers.map((u,i)=><tr key={i} style={{borderBottom:'1px solid '+clr.bd+'22'}}>
                      <td style={{padding:'8px 10px',color:clr.tx}}>{u.name}</td>
                      <td style={{padding:'8px 10px',color:clr.mu}}>{u.clinicianType||'\u2014'}</td>
                      <td style={{padding:'8px 10px',color:clr.mu,fontSize:11}}>{u.email||'\u2014'}</td>
                      <td style={{padding:'8px 10px',color:clr.mu}}>{u.dateOfAgreement||'\u2014'}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>:<div style={{textAlign:'center',padding:'24px 0',color:clr.gn,fontSize:13}}>All users have at least one site number assigned.</div>}
            </div>

            <div style={{background:clr.cd,borderRadius:12,border:'1px solid '+clr.bd,padding:24,marginTop:20}}>
              <h3 style={{fontSize:15,fontWeight:700,margin:0,marginBottom:4}}>5. Column Mapping Diagnostic</h3>
              <p style={{fontSize:12,color:clr.dm,margin:'0 0 16px'}}>Shows each raw column header from the source files and how it was resolved. <span style={{color:clr.gn,fontWeight:600}}>MAPPED</span> = recognized and used by the dashboard. <span style={{color:clr.dm,fontWeight:600}}>NOT USED</span> = not referenced in any analytics. <span style={{color:clr.rd,fontWeight:600}}>UNMAPPED</span> = the dashboard expects this field but the column header didn't match the field map — needs attention.</p>
              {([['Listings',listingHeaders,clr.ac,'listing'],['Sites',siteHeaders,clr.bl,'site'],['Users',userHeaders,clr.pu,'user'],['Referrals',referralHeaders,clr.gn,'referral']] as [string,typeof listingHeaders,string,string][]).map(([label,headers,color,fileType])=>{
                const usedSet=USED_FIELDS[fileType]||new Set();
                return <div key={label} style={{marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:700,color,marginBottom:8,textTransform:'uppercase',letterSpacing:0.5}}>{label} ({headers.length} columns)</div>
                  {headers.length>0?<div style={{maxHeight:300,overflowY:'auto',borderRadius:8,border:'1px solid '+clr.bd+'22'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                      <thead style={{position:'sticky',top:0,zIndex:2,background:clr.cd}}>
                        <tr style={{borderBottom:'2px solid '+clr.bd}}>
                          <th style={{padding:'8px 10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Raw Header</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Mapped To</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Status</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Definition</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Sample Value (row 1)</th>
                          <th style={{padding:'8px 10px',textAlign:'left',color:clr.dm,fontWeight:600,fontSize:10,textTransform:'uppercase'}}>Raw Chars</th>
                        </tr>
                      </thead>
                      <tbody>
                        {headers.map((h,i)=>{const status=h.inMap?'MAPPED':usedSet.has(h.mapped)?'UNMAPPED':'NOT USED';const stColor=status==='MAPPED'?clr.gn:status==='UNMAPPED'?clr.rd:clr.dm;return(<tr key={i} style={{borderBottom:'1px solid '+clr.bd+'22',background:status==='UNMAPPED'?clr.rd+'11':'transparent'}}>
                          <td style={{padding:'6px 10px',fontFamily:"'JetBrains Mono'",color:clr.tx,fontSize:11}}>{h.raw}</td>
                          <td style={{padding:'6px 10px',fontFamily:"'JetBrains Mono'",color:stColor,fontSize:11}}>{h.mapped}</td>
                          <td style={{padding:'6px 10px'}}><span style={{padding:'2px 6px',borderRadius:4,fontSize:9,fontWeight:600,background:stColor+'22',color:stColor}}>{status}</span></td>
                          <td style={{padding:'6px 10px',color:clr.mu,fontSize:11,maxWidth:260,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:FIELD_DEFS[h.raw]?'help':'default'}} title={FIELD_DEFS[h.raw]||''}>{FIELD_DEFS[h.raw]?(FIELD_DEFS[h.raw].length>60?FIELD_DEFS[h.raw].substring(0,60)+'…':FIELD_DEFS[h.raw]):'\u2014'}</td>
                          <td style={{padding:'6px 10px',color:clr.mu,fontSize:11,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={h.sample}>{h.sample||'\u2014'}</td>
                          <td style={{padding:'6px 10px',fontFamily:"'JetBrains Mono'",color:clr.dm,fontSize:9}}>{Array.from(h.raw).map(c=>c.charCodeAt(0)).join(' ')}</td>
                        </tr>);})}
                      </tbody>
                    </table>
                  </div>:<div style={{fontSize:12,color:clr.dm}}>No headers loaded yet.</div>}
                </div>;}
              )}
            </div>
          </>}
          {!dq&&<div style={{textAlign:'center',padding:'40px 0',color:clr.dm}}>Load all three files (Listings, Sites, Users) to run data quality checks.</div>}
        </TabsContent>
      </Tabs>}
      {!any1&&<div style={{textAlign:'center',padding:'60px 0',color:clr.dm}}><div style={{fontSize:48,marginBottom:16,opacity:0.3}}>\uD83D\uDCCA</div><p style={{fontSize:14}}>Upload your Regional Authority export files above to view adoption analytics</p></div>}
    </div>
  </div>;
}
