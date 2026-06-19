import { useState, useRef, useCallback } from "react";

// ============================================================
// BANK ALIAS MAP — normalize ชื่อธนาคารหลากหลายรูปแบบ → key
// ============================================================
const BANK_ALIASES = {
  kbank:   ["kbank","กสิกร","kasikorn","k-merchant","004","069"],
  scb:     ["scb","ไทยพาณิชย์","siam commercial","014"],
  ktb:     ["ktb","กรุงไทย","krungthai","006"],
  bbl:     ["bbl","กรุงเทพ","bangkok bank","002"],
  bay:     ["bay","กรุงศรี","ayudhya","025"],
  ttb:     ["ttb","ทหารไทย","tmb","tbank","011"],
  gsb:     ["gsb","ออมสิน","government savings"],
  ghb:     ["ghb","อาคารสงเคราะห์","government housing"],
  uob:     ["uob","ยูโอบี","024"],
  cimb:    ["cimb","022"],
  lhbank:  ["lh bank","lhbank","ล็อกซเล่ย์","065"],
  kiatnakin:["kiatnakin","เกียรตินาคิน","069"],
  promptpay:["promptpay","พร้อมเพย์","prompt pay","080"],
};

function normalizeBankKey(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/\s+/g,"");
  for (const [key, aliases] of Object.entries(BANK_ALIASES)) {
    if (aliases.some(a => s.includes(a.replace(/\s+/g,"")))) return key;
  }
  return s; // fallback = ตัวเอง
}

function bankDisplayName(key) {
  const names = {
    kbank:"กสิกรไทย (KBank)", scb:"ไทยพาณิชย์ (SCB)",
    ktb:"กรุงไทย (KTB)", bbl:"กรุงเทพ (BBL)",
    bay:"กรุงศรี (BAY)", ttb:"ทหารไทย (TTB)",
    gsb:"ออมสิน (GSB)", ghb:"อาคารสงเคราะห์ (GHB)",
    uob:"ยูโอบี (UOB)", cimb:"CIMB Thai",
    lhbank:"LH Bank", kiatnakin:"เกียรตินาคิน",
    promptpay:"พร้อมเพย์ (PromptPay)",
  };
  return names[key] || key;
}

// ============================================================
// QR DECODER
// ============================================================
function decodeBankFromBillerCode(code3) {
  const map = {
    "004":"kbank","006":"ktb","002":"bbl","014":"scb",
    "025":"bay","011":"ttb","065":"lhbank","022":"cimb",
    "069":"kbank","073":"lhbank","070":"uob","080":"promptpay",
  };
  return map[code3] || null;
}

function decodeQRData(raw) {
  if (!raw || raw.trim().length < 10)
    return { error: "รหัสสั้นเกินไป หรือไม่ใช่ QR มาตรฐาน" };

  const r = raw.trim();
  const info = {
    type: "ไม่ทราบ",
    date: null, time: null,
    senderBankKey: null, receiverBankKey: null,
    receiverBankDisplay: null,
    txRef1: null, txRef2: null,
    phone: null,
  };

  // ---- Bill Payment ----
  if (r.includes("0006000001") || (r.includes("A000000677") && r.includes("0114"))) {
    info.type = "บิลชำระเงิน (Thai QR Bill Payment)";

    // Receiver bank จาก Biller ID
    const billerM = r.match(/00060000010([0-9]{6})/);
    if (billerM) {
      const key = decodeBankFromBillerCode(billerM[1].substring(0,3));
      info.receiverBankKey = key;
      info.receiverBankDisplay = key ? bankDisplayName(key) : `รหัส ${billerM[1].substring(0,3)}`;
    }

    // Ref1 = รหัสหลัก (3DM...)
    const ref1M = r.match(/3DM[A-Za-z0-9]+/);
    if (ref1M) {
      info.txRef1 = ref1M[0];
      const timeM = ref1M[0].match(/[0-9]{12}/);
      if (timeM) {
        const t = timeM[0];
        info.date = `${t.substring(4,6)}/${t.substring(2,4)}/20${t.substring(0,2)}`;
        info.time = `${t.substring(6,8)}:${t.substring(8,10)}:${t.substring(10,12)}`;
      }
    }

    // Ref2 = เลขอ้างอิงที่ 2 (หลังเลขบิลเลอร์)
    // pattern: ตัวเลข/ตัวอักษร 8-20 ตัว ที่ไม่ใช่ ref1
    const ref2Candidates = [...r.matchAll(/[A-Z0-9]{8,20}/g)]
      .map(m => m[0])
      .filter(s => s !== info.txRef1 && !s.startsWith("3DM") && !/^0+$/.test(s));
    if (ref2Candidates.length > 0) info.txRef2 = ref2Candidates[0];

  }
  // ---- PromptPay บุคคล ----
  else if (r.includes("0010A000000677010111") || r.includes("0011A000000677010112")) {
    info.type = "โอนเงินพร้อมเพย์ (PromptPay Transfer)";
    info.receiverBankKey = "promptpay";
    info.receiverBankDisplay = "พร้อมเพย์ (PromptPay)";

    const phoneM = r.match(/01130066([0-9]{9})/);
    const taxM   = r.match(/0213([0-9]{13})/);
    if (phoneM) {
      info.phone = `0${phoneM[1]}`;
      info.receiverBankDisplay = `พร้อมเพย์ 📱 ${info.phone}`;
    } else if (taxM) {
      info.phone = taxM[1];
      info.receiverBankDisplay = `พร้อมเพย์ 🆔 ${taxM[1]}`;
    }
    info.txRef1 = "—"; info.txRef2 = "—";
  }
  // ---- Slip Verify QR ----
  else if (r.includes("0055")) {
    info.type = "สลิปตรวจสอบ (Slip Verification QR)";
    const refs = [...r.matchAll(/([A-Za-z0-9]{15,30})/g)].map(m => m[1]);
    if (refs[0]) info.txRef1 = refs[0];
    if (refs[1]) info.txRef2 = refs[1];
    const dateM = r.match(/(202[0-9])(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([0-2][0-9])([0-5][0-9])([0-5][0-9])/);
    if (dateM) {
      info.date = `${dateM[3]}/${dateM[2]}/${dateM[1]}`;
      info.time = `${dateM[4]}:${dateM[5]}:${dateM[6]}`;
    }
  }
  // ---- Generic fallback ----
  else {
    const dateM = r.match(/(202[0-9])(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([0-2][0-9])([0-5][0-9])([0-5][0-9])/);
    if (dateM) {
      info.date  = `${dateM[3]}/${dateM[2]}/${dateM[1]}`;
      info.time  = `${dateM[4]}:${dateM[5]}:${dateM[6]}`;
      info.type  = "QR ทั่วไป (พบรูปแบบเวลา)";
    }
    const refs = [...r.matchAll(/[A-Z0-9]{12,32}/g)].map(m => m[0]).filter(s => !/^0+$/.test(s));
    if (refs[0]) info.txRef1 = refs[0];
    if (refs[1]) info.txRef2 = refs[1];
    if (!dateM && !refs.length) return { error: "ไม่ใช่ QR มาตรฐานพร้อมเพย์หรือบิลชำระเงินของไทย" };
  }

  return info;
}

// ============================================================
// COMPARE — กฎใหม่ที่เข้มงวด
// ============================================================
function compareFields(qrData, slipData) {
  const results = [];

  // normalize ทั่วไป (ตัดอักขระพิเศษ lowercase)
  const norm = s => (s||"").toString().replace(/[^0-9a-zA-Z\u0E00-\u0E7F]/g,"").toLowerCase().trim();

  // exact match เท่านั้น (ใช้กับ ref + bank)
  const exactMatch = (a, b) => {
    const na = norm(a), nb = norm(b);
    if (!na || !nb || na === "—" || nb === "—") return null; // ไม่มีข้อมูล
    return na === nb;
  };

  // soft match (ยอมรับ substring — ใช้กับวัน/เวลา)
  const softMatch = (a, b) => {
    const na = norm(a), nb = norm(b);
    if (!na || !nb || na === "—" || nb === "—") return null;
    return na === nb || na.includes(nb) || nb.includes(na);
  };

  // bank match ผ่าน alias key
  const bankMatch = (qrKey, slipRaw) => {
    if (!qrKey || !slipRaw) return null;
    const slipKey = normalizeBankKey(slipRaw);
    if (!slipKey) return null;
    return qrKey === slipKey;
  };

  // ---- 5 จุด ----
  // 1. วันที่
  const dateRes = softMatch(qrData.date, slipData.date);
  results.push({ label:"วันที่ (ว/ด/ป)", qrVal:qrData.date, slipVal:slipData.date,
    match: dateRes === true, isEmpty: dateRes === null, critical:false, weight:1 });

  // 2. เวลา (เช็คแค่ HH:MM ไม่ต้องถึงวินาที)
  const normTime = s => (s||"").replace(/[^0-9:]/g,"").substring(0,5);
  const timeQ = normTime(qrData.time), timeS = normTime(slipData.time);
  const timeRes = timeQ && timeS ? timeQ === timeS : null;
  results.push({ label:"เวลา (HH:MM)", qrVal:qrData.time, slipVal:slipData.time,
    match: timeRes === true, isEmpty: timeRes === null, critical:false, weight:1 });

  // 3. ธนาคารผู้รับ → CRITICAL (100%)
  const bankRes = bankMatch(qrData.receiverBankKey, slipData.receiverBank);
  results.push({ label:"ธนาคารผู้รับ", qrVal:qrData.receiverBankDisplay, slipVal:slipData.receiverBank,
    match: bankRes === true, isEmpty: bankRes === null, critical:true, weight:2,
    criticalLabel:"🏦 ธนาคารผู้รับ" });

  // 4. เลขรายการ Ref1 → CRITICAL (100% exact)
  const ref1Q = (qrData.txRef1||"").replace(/\s/g,"");
  const ref1S = (slipData.txRef1||"").replace(/\s/g,"");
  const ref1Res = ref1Q && ref1S && ref1Q !== "—" && ref1S !== "—"
    ? ref1Q.toUpperCase() === ref1S.toUpperCase() : null;
  results.push({ label:"เลขรายการ Ref 1", qrVal:qrData.txRef1, slipVal:slipData.txRef1,
    match: ref1Res === true, isEmpty: ref1Res === null, critical:true, weight:2,
    criticalLabel:"🔑 Ref 1" });

  // 5. เลขรายการ Ref2 (ถ้ามี) → CRITICAL (100% exact)
  const ref2Q = (qrData.txRef2||"").replace(/\s/g,"");
  const ref2S = (slipData.txRef2||"").replace(/\s/g,"");
  const hasRef2 = ref2Q && ref2S && ref2Q !== "—" && ref2S !== "—";
  const ref2Res = hasRef2 ? ref2Q.toUpperCase() === ref2S.toUpperCase() : null;
  results.push({ label:"เลขรายการ Ref 2", qrVal:qrData.txRef2||"—", slipVal:slipData.txRef2||"—",
    match: ref2Res === true, isEmpty: ref2Res === null, critical: hasRef2, weight: hasRef2 ? 2 : 0,
    criticalLabel:"🔑 Ref 2" });

  // ---- ตัดสิน ----
  const criticals = results.filter(r => r.critical && !r.isEmpty);
  const criticalFail = criticals.filter(r => !r.match);
  const matched = results.filter(r => !r.isEmpty && r.match).length;
  const total   = results.filter(r => !r.isEmpty).length;

  let verdict, verdictColor, verdictIcon, verdictDetail;

  if (criticalFail.length > 0) {
    // Critical ไม่ผ่าน = ปลอม 100%
    const failNames = criticalFail.map(r => r.criticalLabel || r.label).join(", ");
    verdict = "🚨 ปลอม 100%";
    verdictColor = "#ef4444";
    verdictIcon = "🚨";
    verdictDetail = `Critical ไม่ผ่าน: ${failNames}`;
  } else if (criticals.length > 0 && criticalFail.length === 0) {
    // Critical ผ่านหมด
    if (matched >= 4) {
      verdict = "✅ จริง — ผ่านครบทุกจุด";
      verdictColor = "#22c55e";
      verdictIcon = "✅";
      verdictDetail = `ตรงกัน ${matched}/${total} จุด`;
    } else if (matched >= 3) {
      verdict = "⚠️ น่าเชื่อถือ (ระวัง)";
      verdictColor = "#f59e0b";
      verdictIcon = "⚠️";
      verdictDetail = `Critical ผ่าน แต่ตรงกันแค่ ${matched}/${total} จุด`;
    } else {
      verdict = "⚠️ ต้องตรวจสอบเพิ่ม";
      verdictColor = "#f97316";
      verdictIcon = "⚠️";
      verdictDetail = `Critical ผ่าน แต่ตรงกันน้อย ${matched}/${total} จุด`;
    }
  } else {
    verdict = "❓ ข้อมูลไม่เพียงพอ";
    verdictColor = "#64748b";
    verdictIcon = "❓";
    verdictDetail = "ไม่มีข้อมูล Critical เพียงพอในการตัดสิน";
  }

  return { results, matched, total, verdict, verdictColor, verdictIcon, verdictDetail, criticalFail };
}

// ============================================================
// CLAUDE VISION API
// ============================================================
async function analyzeSlipImage(base64Image, mimeType) {
  const prompt = `คุณคือผู้เชี่ยวชาญด้านสลิปธนาคารไทย อ่านข้อมูลในภาพสลิปนี้อย่างละเอียดที่สุด

ตอบเฉพาะ JSON ต่อไปนี้เท่านั้น ห้ามมีข้อความอื่น:
{
  "date": "วัน/เดือน/ปี เช่น 15/06/2568 หรือ 15/06/2025 (แปลงพุทธศักราชเป็นคริสต์ศักราชด้วย ถ้าเห็นปี 2568 ให้ใส่ 2568)",
  "time": "HH:MM:SS เช่น 14:32:05",
  "senderBank": "ชื่อธนาคารที่โอนออก (ธนาคารต้นทาง)",
  "receiverBank": "ชื่อธนาคารที่รับโอน (ธนาคารปลายทาง/ผู้รับ) — สำคัญมาก",
  "txRef1": "เลขอ้างอิงหลัก / Ref No. 1 / Transaction ID / เลขที่รายการ (ตัวแรก) — คัดลอกทุกตัวอักษร",
  "txRef2": "เลขอ้างอิงที่ 2 / Ref No. 2 (ถ้ามีเลขอ้างอิงที่สองในสลิป) หรือ null",
  "amount": "จำนวนเงิน",
  "confidence": "HIGH หรือ MEDIUM หรือ LOW",
  "notes": "หมายเหตุถ้ามี"
}

กฎสำคัญ:
- txRef1 และ txRef2 ต้องคัดลอกตัวอักษรให้ครบถ้วน 100% ห้ามตัดทอน
- receiverBank ให้ระบุชื่อเต็มของธนาคารปลายทาง
- null ถ้าไม่เห็น`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mimeType, data: base64Image } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });

  const data = await resp.json();
  const text = (data.content||[]).map(c => c.text||"").join("");
  const clean = text.replace(/```json|```/g,"").trim();
  try { return JSON.parse(clean); }
  catch { return { error: "Parse ไม่ได้: " + text.substring(0,300) }; }
}

// ============================================================
// COMPONENT
// ============================================================
export default function SlipVerifier() {
  const [mode, setMode]           = useState("image");
  const [slipImage, setSlipImage] = useState(null);
  const [slipB64, setSlipB64]     = useState(null);
  const [slipMime, setSlipMime]   = useState("image/jpeg");
  const [qrCode, setQrCode]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [step, setStep]           = useState("");
  const [qrResult, setQrResult]   = useState(null);
  const [slipResult, setSlipResult] = useState(null);
  const [cmpResult, setCmpResult] = useState(null);
  const [error, setError]         = useState(null);
  const [inputMode, setInputMode] = useState("auto");
  const [manual, setManual]       = useState({
    date:"", time:"", senderBank:"", receiverBank:"", txRef1:"", txRef2:""
  });
  const fileRef = useRef();

  const reset = () => { setQrResult(null); setSlipResult(null); setCmpResult(null); setError(null); };

  const onFile = useCallback(file => {
    if (!file) return;
    setSlipMime(file.type || "image/jpeg");
    const r = new FileReader();
    r.onload = ev => {
      setSlipImage(ev.target.result);
      setSlipB64(ev.target.result.split(",")[1]);
    };
    r.readAsDataURL(file);
    reset();
  }, []);

  const run = async () => {
    reset();
    setLoading(true);
    try {
      setStep("🔍 ถอดรหัส QR...");
      let qr = null;
      if (qrCode.trim()) {
        qr = decodeQRData(qrCode.trim());
        if (qr.error) { setError("❌ " + qr.error); setLoading(false); return; }
        setQrResult(qr);
      }

      let slip = null;
      if (inputMode === "auto" && slipB64) {
        setStep("🤖 AI อ่านสลิป...");
        slip = await analyzeSlipImage(slipB64, slipMime);
        if (slip.error) { setError("❌ " + slip.error); setLoading(false); return; }
        setSlipResult(slip);
      } else if (inputMode === "manual") {
        slip = { ...manual };
        setSlipResult(slip);
      }

      if (qr && slip) {
        setStep("⚖️ เปรียบเทียบ...");
        setCmpResult(compareFields(qr, slip));
      }
      setStep("");
    } catch(e) { setError("❌ " + e.message); }
    finally { setLoading(false); }
  };

  const canRun = qrCode.trim().length > 10 &&
    (inputMode === "auto" ? !!slipB64 : Object.values(manual).some(v=>v));

  const S = {
    page: { minHeight:"100vh", background:"linear-gradient(135deg,#0a0f1e 0%,#12173a 50%,#0a0f1e 100%)",
      fontFamily:"'Segoe UI','Helvetica Neue',sans-serif", color:"#e2e8f0", padding:"16px" },
    card: { background:"rgba(255,255,255,0.05)", borderRadius:14, padding:16,
      marginBottom:12, border:"1px solid rgba(99,102,241,0.25)" },
    label: { fontSize:12, fontWeight:700, color:"#a5b4fc", display:"block", marginBottom:7 },
    textarea: { width:"100%", boxSizing:"border-box", background:"rgba(0,0,0,0.35)",
      border:"1px solid rgba(99,102,241,0.4)", borderRadius:8, padding:"9px 11px",
      color:"#e2e8f0", fontSize:12, fontFamily:"monospace", resize:"vertical", outline:"none" },
    input: { width:"100%", boxSizing:"border-box", background:"rgba(0,0,0,0.3)",
      border:"1px solid rgba(99,102,241,0.3)", borderRadius:7, padding:"7px 10px",
      color:"#e2e8f0", fontSize:12, outline:"none" },
    btn: (active, danger) => ({
      padding:"8px 16px", borderRadius:9, border:"none", cursor:"pointer",
      fontSize:12, fontWeight:700,
      background: danger ? "rgba(239,68,68,0.15)" : active
        ? "linear-gradient(90deg,#6366f1,#8b5cf6)" : "rgba(255,255,255,0.08)",
      color: active ? "#fff" : "#94a3b8", transition:"all 0.18s",
      boxShadow: active ? "0 0 14px rgba(99,102,241,0.45)" : "none",
    }),
  };

  const FieldRow = ({ f }) => {
    const isCrit = f.critical && !f.isEmpty;
    const bg  = f.isEmpty ? "rgba(255,255,255,0.03)"
               : f.match  ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.1)";
    const bdr = f.isEmpty ? "rgba(255,255,255,0.08)"
               : f.match  ? "rgba(34,197,94,0.3)"  : "rgba(239,68,68,0.5)";
    return (
      <div style={{ background:bg, border:`1px solid ${bdr}`, borderRadius:11,
        padding:"10px 12px", position:"relative" }}>
        {isCrit && <span style={{ position:"absolute", top:-8, right:10,
          background: f.match ? "#065f46" : "#7f1d1d",
          color: f.match ? "#34d399" : "#fca5a5",
          fontSize:9, padding:"2px 8px", borderRadius:10, fontWeight:800,
          border:`1px solid ${f.match?"#34d39944":"#ef444444"}` }}>
          {f.criticalLabel || "🔑 CRITICAL"}
        </span>}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
          <span style={{ fontSize:12, fontWeight:700, color:"#cbd5e1" }}>{f.label}</span>
          <span style={{ fontSize:11, fontWeight:800, padding:"2px 10px", borderRadius:20,
            background: f.isEmpty ? "rgba(255,255,255,0.06)"
              : f.match ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
            color: f.isEmpty ? "#64748b" : f.match ? "#34d399" : "#f87171" }}>
            {f.isEmpty ? "ไม่มีข้อมูล" : f.match ? "✓ ตรงกัน" : "✗ ไม่ตรง"}
          </span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
          {[["📦 QR","#6366f1","#a5b4fc", f.qrVal],
            ["🧾 สลิป","#10b981","#6ee7b7", f.slipVal]].map(([lbl,lc,vc,val])=>(
            <div key={lbl}>
              <div style={{ fontSize:10, color:lc, marginBottom:2 }}>{lbl}</div>
              <div style={{ fontSize:11, color:vc, wordBreak:"break-all",
                fontFamily:"monospace", fontWeight: f.critical ? 700 : 400 }}>
                {val||"—"}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div style={S.page}>
      {/* HEADER */}
      <div style={{ textAlign:"center", marginBottom:22 }}>
        <div style={{ display:"inline-flex", alignItems:"center", gap:9,
          background:"linear-gradient(90deg,#4f46e5,#7c3aed)", borderRadius:12,
          padding:"9px 20px", marginBottom:10, boxShadow:"0 0 28px rgba(99,102,241,0.35)" }}>
          <span style={{fontSize:20}}>🛡️</span>
          <span style={{fontWeight:800,fontSize:14,letterSpacing:1}}>PROGRAMMER-IT</span>
        </div>
        <h1 style={{ fontSize:20, fontWeight:800, margin:"0 0 3px",
          background:"linear-gradient(90deg,#a5f3fc,#818cf8)",
          WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
          Thai Slip QR Verifier v2
        </h1>
        <p style={{ color:"#64748b", fontSize:12, margin:0 }}>
          ตรวจสลิปด้วย AI Vision + EMV QR Decode • Critical: Ref1 + Ref2 + ธนาคารรับ = 100%
        </p>
      </div>

      {/* MODE */}
      <div style={{ display:"flex", gap:7, justifyContent:"center", marginBottom:16 }}>
        {[["image","📸 ภาพสลิป + QR"],["qr","🔢 QR เดี่ยว"]].map(([id,lbl])=>(
          <button key={id} style={S.btn(mode===id)} onClick={()=>{setMode(id);reset();}}>
            {lbl}
          </button>
        ))}
      </div>

      <div style={{ maxWidth:680, margin:"0 auto" }}>
        {/* QR INPUT */}
        <div style={S.card}>
          <label style={S.label}>🔢 รหัส QR Code (วางตัวยาวที่ได้จากสแกนสลิป)</label>
          <textarea value={qrCode} onChange={e=>setQrCode(e.target.value)}
            placeholder="000201010212..." rows={3} style={S.textarea} />
          {qrCode.trim().length > 0 &&
            <div style={{ marginTop:5, fontSize:11, color:"#475569" }}>
              {qrCode.trim().length} ตัวอักษร
            </div>}
        </div>

        {/* SLIP INPUT */}
        {mode === "image" && (
          <div style={S.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:11 }}>
              <label style={{...S.label, marginBottom:0}}>📸 ภาพสลิป</label>
              <div style={{ display:"flex", gap:6 }}>
                {[["auto","🤖 AI อ่าน"],["manual","✍️ กรอกเอง"]].map(([m,lbl])=>(
                  <button key={m} style={S.btn(inputMode===m)} onClick={()=>setInputMode(m)}>{lbl}</button>
                ))}
              </div>
            </div>

            {inputMode === "auto" ? (
              <>
                <div onClick={()=>fileRef.current?.click()}
                  onDrop={e=>{e.preventDefault();onFile(e.dataTransfer.files?.[0]);}}
                  onDragOver={e=>e.preventDefault()}
                  style={{ border:"2px dashed rgba(99,102,241,0.4)", borderRadius:10,
                    padding:18, textAlign:"center", cursor:"pointer",
                    background: slipImage ? "rgba(99,102,241,0.08)" : "rgba(0,0,0,0.18)" }}>
                  {slipImage
                    ? <img src={slipImage} alt="slip"
                        style={{ maxHeight:200, maxWidth:"100%", borderRadius:8, objectFit:"contain" }} />
                    : <><div style={{fontSize:30,marginBottom:6}}>📄</div>
                       <div style={{color:"#94a3b8",fontSize:13}}>คลิก หรือลากภาพสลิปมาวาง</div>
                       <div style={{color:"#475569",fontSize:11,marginTop:3}}>JPG · PNG · WEBP</div></>}
                </div>
                <input ref={fileRef} type="file" accept="image/*"
                  onChange={e=>onFile(e.target.files?.[0])} style={{display:"none"}} />
              </>
            ) : (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:9 }}>
                {[
                  {k:"date",       lbl:"วันที่",           ph:"15/06/2568",    full:false},
                  {k:"time",       lbl:"เวลา",             ph:"14:32:05",      full:false},
                  {k:"senderBank", lbl:"ธนาคารโอน",        ph:"กสิกรไทย",      full:false},
                  {k:"receiverBank",lbl:"ธนาคารรับ 🔑",   ph:"ไทยพาณิชย์",    full:false},
                  {k:"txRef1",     lbl:"Ref 1 (เลขรายการหลัก) 🔑", ph:"3DMXXXXXX...", full:true},
                  {k:"txRef2",     lbl:"Ref 2 (เลขอ้างอิงที่ 2) 🔑",ph:"ถ้ามีเลขสอง...", full:true},
                ].map(({k,lbl,ph,full})=>(
                  <div key={k} style={{ gridColumn: full ? "1 / -1" : "auto" }}>
                    <label style={{ fontSize:11, color:"#94a3b8", display:"block", marginBottom:3 }}>{lbl}</label>
                    <input value={manual[k]} onChange={e=>setManual(p=>({...p,[k]:e.target.value}))}
                      placeholder={ph} style={S.input} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* RUN BUTTON */}
        <button onClick={run} disabled={loading||!canRun}
          style={{
            width:"100%", padding:"13px 0", marginBottom:18,
            background: loading||!canRun ? "rgba(99,102,241,0.15)"
              : "linear-gradient(90deg,#4f46e5,#7c3aed)",
            border:"none", borderRadius:12,
            color: loading||!canRun ? "#475569" : "#fff",
            fontSize:14, fontWeight:800,
            cursor: loading||!canRun ? "not-allowed" : "pointer",
            boxShadow: loading||!canRun ? "none" : "0 0 24px rgba(99,102,241,0.45)",
            transition:"all 0.2s",
          }}>
          {loading ? `⏳ ${step}` : "🔍 ตรวจสอบสลิป"}
        </button>

        {error && <div style={{ background:"rgba(239,68,68,0.12)", border:"1px solid rgba(239,68,68,0.4)",
          borderRadius:10, padding:13, marginBottom:14, color:"#fca5a5", fontSize:13 }}>{error}</div>}

        {/* QR RESULT */}
        {qrResult && (
          <div style={{...S.card, borderColor:"rgba(99,102,241,0.4)"}}>
            <div style={{ fontWeight:800, color:"#a5b4fc", marginBottom:10, fontSize:13 }}>
              📦 ถอดรหัส QR — {qrResult.type}
            </div>
            <div style={{ display:"grid", gap:5 }}>
              {[
                ["วันที่",          qrResult.date],
                ["เวลา",            qrResult.time],
                ["ธนาคารรับ",       qrResult.receiverBankDisplay],
                ["Ref 1 (หลัก)",   qrResult.txRef1],
                ["Ref 2",           qrResult.txRef2],
              ].filter(([,v])=>v).map(([k,v])=>(
                <div key={k} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                  <span style={{ color:"#64748b", fontSize:11, minWidth:100 }}>{k}</span>
                  <span style={{
                    color: k.startsWith("Ref") ? "#34d399" : "#e2e8f0",
                    fontSize: k.startsWith("Ref") ? 11 : 12,
                    fontFamily: k.startsWith("Ref") ? "monospace" : "inherit",
                    fontWeight: k.startsWith("Ref") ? 800 : 400,
                    wordBreak:"break-all",
                  }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SLIP RESULT */}
        {slipResult && !slipResult.error && (
          <div style={{...S.card, borderColor:"rgba(16,185,129,0.3)"}}>
            <div style={{ fontWeight:800, color:"#6ee7b7", marginBottom:10, fontSize:13,
              display:"flex", alignItems:"center", gap:8 }}>
              🧾 ข้อมูลจากสลิป
              {slipResult.confidence && (
                <span style={{ fontSize:10, padding:"2px 8px", borderRadius:20, fontWeight:700,
                  background: slipResult.confidence==="HIGH" ? "rgba(16,185,129,0.25)"
                    : slipResult.confidence==="MEDIUM" ? "rgba(245,158,11,0.25)" : "rgba(239,68,68,0.25)",
                  color: slipResult.confidence==="HIGH" ? "#34d399"
                    : slipResult.confidence==="MEDIUM" ? "#fbbf24" : "#f87171" }}>
                  {slipResult.confidence}
                </span>
              )}
            </div>
            <div style={{ display:"grid", gap:5 }}>
              {[
                ["วันที่",        slipResult.date],
                ["เวลา",          slipResult.time],
                ["ธนาคารโอน",     slipResult.senderBank],
                ["ธนาคารรับ",     slipResult.receiverBank],
                ["Ref 1",         slipResult.txRef1],
                ["Ref 2",         slipResult.txRef2],
                ["จำนวนเงิน",    slipResult.amount],
              ].filter(([,v])=>v).map(([k,v])=>(
                <div key={k} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                  <span style={{ color:"#64748b", fontSize:11, minWidth:100 }}>{k}</span>
                  <span style={{
                    color: k.startsWith("Ref") ? "#34d399" : "#e2e8f0",
                    fontSize: k.startsWith("Ref") ? 11 : 12,
                    fontFamily: k.startsWith("Ref") ? "monospace" : "inherit",
                    fontWeight: k.startsWith("Ref") ? 800 : 400,
                    wordBreak:"break-all",
                  }}>{v}</span>
                </div>
              ))}
            </div>
            {slipResult.notes && (
              <div style={{ marginTop:7, fontSize:11, color:"#94a3b8", fontStyle:"italic" }}>
                หมายเหตุ: {slipResult.notes}
              </div>
            )}
          </div>
        )}

        {/* COMPARISON */}
        {cmpResult && (
          <div style={{ background:"rgba(255,255,255,0.03)",
            border:`2px solid ${cmpResult.verdictColor}`,
            borderRadius:16, padding:18, marginBottom:18,
            boxShadow:`0 0 35px ${cmpResult.verdictColor}35` }}>

            {/* VERDICT BOX */}
            <div style={{ textAlign:"center", padding:"16px 0", marginBottom:16,
              background:`${cmpResult.verdictColor}18`, borderRadius:12 }}>
              <div style={{ fontSize:32, marginBottom:5 }}>{cmpResult.verdictIcon}</div>
              <div style={{ fontSize:20, fontWeight:900, color:cmpResult.verdictColor }}>
                {cmpResult.verdict}
              </div>
              <div style={{ fontSize:12, color:"#94a3b8", marginTop:5 }}>
                {cmpResult.verdictDetail}
              </div>
            </div>

            {/* CRITICAL ALERT */}
            {cmpResult.criticalFail.length > 0 && (
              <div style={{ background:"rgba(239,68,68,0.15)", border:"1px solid rgba(239,68,68,0.5)",
                borderRadius:10, padding:"10px 14px", marginBottom:14,
                fontSize:12, color:"#fca5a5", fontWeight:700 }}>
                🚨 CRITICAL ไม่ผ่าน: {cmpResult.criticalFail.map(f=>f.label).join(" · ")}
                <div style={{ fontWeight:400, marginTop:3, fontSize:11, color:"#f87171" }}>
                  หากธนาคารผู้รับ หรือเลขรายการ ไม่ตรง = ปลอม 100% ไม่สนใจจุดอื่น
                </div>
              </div>
            )}

            {/* FIELD LIST */}
            <div style={{ display:"grid", gap:9 }}>
              {cmpResult.results.map(f => <FieldRow key={f.label} f={f} />)}
            </div>

            {/* LEGEND */}
            <div style={{ marginTop:14, display:"grid", gridTemplateColumns:"1fr 1fr", gap:7 }}>
              {[
                ["🔑 CRITICAL","Ref1, Ref2, ธนาคารรับ — ต้อง 100% exact"],
                ["✓ ตรงกัน","ข้อมูลตรงกัน"],
                ["✗ ไม่ตรง","ข้อมูลไม่ตรงกัน"],
                ["ไม่มีข้อมูล","ฝ่ายใดฝ่ายหนึ่งไม่มีข้อมูล"],
              ].map(([k,v])=>(
                <div key={k} style={{ fontSize:10, color:"#475569" }}>
                  <span style={{ color:"#94a3b8", fontWeight:700 }}>{k}</span> — {v}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* QR ONLY RESULT */}
        {mode==="qr" && qrResult && !cmpResult && (
          <div style={{...S.card, textAlign:"center", color:"#64748b", fontSize:13}}>
            ✅ ถอดรหัส QR สำเร็จ — สลับโหมด "ภาพสลิป + QR" เพื่อเปรียบเทียบ
          </div>
        )}

        <div style={{ textAlign:"center", color:"#1e293b", fontSize:11, marginTop:8 }}>
          PROGRAMMER-IT • EMV QR Decoder v2 • AI Vision Slip Reader • Critical 3-Point Guard
        </div>
      </div>
    </div>
  );
}
