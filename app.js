/* ============================================================
   アルバイト管理統合システム — app.js  (v3)
   状態機械 + UI誘導エンジン + スタッフ別データ反映
   ============================================================ */

/* ----------------------------------------------------------
   UNDEFINED ITEMS (SDS未定義):
   - シフト同時編集競合制御 / 打刻改ざん対策 / GPS併用
   - CSV項目定義 / バックアップ復元方式 / 通知テンプレ編集
   - 臨時休業中の給与扱い / 労基法警告範囲
   - 店舗管理機能詳細 / 将来LINE認証方式
   ---------------------------------------------------------- */

/* ═══════════════════════════════════════
   定数・マスター定義
═══════════════════════════════════════ */
const ROLES = { ADMIN: 'admin', MANAGER: 'manager', PART_TIME: 'part_time' };
const ROLE_LABEL = { admin: '管理者', manager: '店長', part_time: 'アルバイト' };

const STATES = {
  LOGGED_OUT:          '未ログイン',
  SHIFT_REQ_PENDING:   '勤務希望未提出',
  SHIFT_REQ_SUBMITTED: '勤務希望提出済',
  SHIFT_CREATING:      'シフト作成中',
  SHIFT_CONFIRMED:     'シフト確定済',
  SHIFT_PUBLISHED:     'シフト公開済',
  PRE_WORK:            '出勤前',
  WORKING:             '出勤中',
  ON_BREAK:            '休憩中',
  OVERTIME_APPLYING:   '残業申請中',
  ABSENCE_APPLYING:    '欠勤申請中',
  REPLACEMENT_OPEN:    '代替募集中',
  ATTENDANCE_PENDING:  '勤怠未確定',
  SALARY_PENDING:      '給与未計算',
  NOTIFY_FAILED:       '通知送信失敗',
};

const EVENT_ROUTES = {
  LOGIN:               { from: [STATES.LOGGED_OUT],                                    to: STATES.SHIFT_REQ_PENDING,   roles: [ROLES.ADMIN, ROLES.MANAGER, ROLES.PART_TIME] },
  SHIFT_REQUEST_SUBMIT:{ from: [STATES.SHIFT_REQ_PENDING, STATES.SHIFT_REQ_SUBMITTED],  to: STATES.SHIFT_REQ_SUBMITTED, roles: [ROLES.PART_TIME] },
  SHIFT_SAVE:          { from: [STATES.SHIFT_CREATING],                                to: STATES.SHIFT_CREATING,      roles: [ROLES.MANAGER] },
  SHIFT_CONFIRM:       { from: [STATES.SHIFT_CREATING, STATES.SHIFT_CONFIRMED],       to: STATES.SHIFT_CONFIRMED,     roles: [ROLES.MANAGER] },
  SHIFT_PUBLISH:       { from: [STATES.SHIFT_CONFIRMED],                               to: STATES.SHIFT_PUBLISHED,     roles: [ROLES.ADMIN, ROLES.MANAGER] },
  ABSENCE_APPLY:       { from: [STATES.SHIFT_PUBLISHED, STATES.ABSENCE_APPLYING],      to: STATES.ABSENCE_APPLYING,    roles: [ROLES.PART_TIME] },
  CLOCK_IN:            { from: [STATES.PRE_WORK],                                      to: STATES.WORKING,             roles: [ROLES.PART_TIME, ROLES.MANAGER, ROLES.ADMIN] },
  BREAK_START:         { from: [STATES.WORKING],                                        to: STATES.ON_BREAK,            roles: [ROLES.PART_TIME, ROLES.MANAGER, ROLES.ADMIN] },
  BREAK_END:           { from: [STATES.ON_BREAK],                                       to: STATES.WORKING,             roles: [ROLES.PART_TIME, ROLES.MANAGER, ROLES.ADMIN] },
  CLOCK_OUT:           { from: [STATES.WORKING],                                        to: STATES.ATTENDANCE_PENDING,  roles: [ROLES.PART_TIME, ROLES.MANAGER, ROLES.ADMIN] },
  OVERTIME_APPLY:      { from: [STATES.OVERTIME_APPLYING],                              to: STATES.WORKING,             roles: [ROLES.PART_TIME] },
  ATTENDANCE_FIX:      { from: [STATES.ATTENDANCE_PENDING],                             to: STATES.ATTENDANCE_PENDING,  roles: [ROLES.MANAGER, ROLES.ADMIN] },
  ATTENDANCE_CONFIRM:  { from: [STATES.ATTENDANCE_PENDING],                             to: STATES.SALARY_PENDING,      roles: [ROLES.ADMIN, ROLES.MANAGER] },
  SALARY_CALC:         { from: [STATES.SALARY_PENDING],                                 to: STATES.SALARY_PENDING,      roles: [ROLES.ADMIN] },
  NOTIFY_RETRY:        { from: [STATES.NOTIFY_FAILED],                                  to: STATES.NOTIFY_FAILED,       roles: [ROLES.ADMIN, ROLES.MANAGER] },
  REPLACEMENT_APPLY:   { from: [STATES.REPLACEMENT_OPEN],                               to: STATES.REPLACEMENT_OPEN,    roles: [ROLES.PART_TIME] },
};

const RULES = {
  SESSION_HOURS: 8, MAX_LOGIN_FAILURES: 5,
  LATE_NIGHT_BONUS: 1.25, HOLIDAY_BONUS: 1.35, OVERTIME_HOURS: 8,
  WIFI_REQUIRED: true, OFFLINE_CLOCK_IN: true, LATE_NIGHT_MINOR_BAN: true,
};

/* ═══════════════════════════════════════
   スタッフマスター（50名）
   ※ 操作で変化するフィールド:
     state / clockIn / clockOut / breakMin / overtimeMin / note
═══════════════════════════════════════ */
const DEMO = {
  staff: [
    { id:  1, name: '佐藤 健一',   role: ROLES.ADMIN,      state: STATES.LOGGED_OUT,      store: '渋谷店', age: 42, hourlyRate: null, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id:  2, name: '高橋 美智子', role: ROLES.ADMIN,      state: STATES.LOGGED_OUT,       store: '新宿店', age: 38, hourlyRate: null, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id:  3, name: '山田 太郎',   role: ROLES.MANAGER,    state: STATES.LOGGED_OUT,      store: '渋谷店', age: 35, hourlyRate: null, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id:  4, name: '鈴木 恵子',   role: ROLES.MANAGER,    state: STATES.LOGGED_OUT,     store: '新宿店', age: 31, hourlyRate: null, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id:  5, name: '伊藤 誠',     role: ROLES.MANAGER,    state: STATES.LOGGED_OUT,  store: '池袋店', age: 40, hourlyRate: null, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,  note: '出勤前' },
    { id:  6, name: '渡辺 美香',   role: ROLES.MANAGER,    state: STATES.LOGGED_OUT,             store: '渋谷店', age: 29, hourlyRate: null, clockIn: null, clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id:  7, name: '田中 花子',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT, store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id:  8, name: '中村 拓也',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,   store: '新宿店', age: 19, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id:  9, name: '小林 さくら', role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,   store: '池袋店', age: 17, hourlyRate: 1050, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前', isMinor: true },
    { id: 10, name: '加藤 健太',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT, store: '渋谷店', age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 11, name: '吉田 あおい', role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,   store: '新宿店', age: 25, hourlyRate: 1200, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 12, name: '山本 勇気',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT, store: '渋谷店', age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 13, name: '松本 優',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT, store: '池袋店', age: 18, hourlyRate: 1050, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前', isMinor: true },
    { id: 14, name: '井上 彩花',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT, store: '新宿店', age: 23, hourlyRate: 1180, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 15, name: '木村 蓮',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT, store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 16, name: '林 奈々',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,     store: '渋谷店', age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 17, name: '清水 航',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,     store: '新宿店', age: 24, hourlyRate: 1200, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 18, name: '山崎 柚子',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,     store: '池袋店', age: 19, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 19, name: '森 悠斗',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,            store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 20, name: '池田 莉子',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,            store: '新宿店', age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 21, name: '橋本 颯太',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,            store: '渋谷店', age: 18, hourlyRate: 1050, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前', isMinor: true },
    { id: 22, name: '阿部 千夏',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,             store: '渋谷店', age: 23, hourlyRate: 1180, clockIn: null, clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 23, name: '石川 大翔',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,             store: '新宿店', age: 25, hourlyRate: 1200, clockIn: null, clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 24, name: '前田 みずき', role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,             store: '池袋店', age: 22, hourlyRate: 1150, clockIn: null, clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 25, name: '藤田 蒼',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,             store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: null, clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 26, name: '岡田 里奈',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,             store: '新宿店', age: 19, hourlyRate: 1100, clockIn: null, clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 27, name: '後藤 翔平',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,             store: '渋谷店', age: 26, hourlyRate: 1250, clockIn: null, clockOut: null,    breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 28, name: '長谷川 葵',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,            store: '渋谷店', age: 21, hourlyRate: 1150, clockIn: null, clockOut: null,    breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 29, name: '村田 晴菜',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,            store: '池袋店', age: 20, hourlyRate: 1100, clockIn: null, clockOut: null,    breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 30, name: '近藤 朔',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,            store: '新宿店', age: 24, hourlyRate: 1200, clockIn: null, clockOut: null,    breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 31, name: '藤井 結月',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,             store: '渋谷店', age: 22, hourlyRate: 1150, clockIn: null, clockOut: null,    breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 32, name: '西村 拓海',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,             store: '新宿店', age: 28, hourlyRate: 1300, clockIn: null, clockOut: null,    breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 33, name: '福田 ひより', role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,     store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 34, name: '岡本 亮',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,     store: '池袋店', age: 23, hourlyRate: 1180, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 35, name: '遠藤 菜々美', role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,     store: '新宿店', age: 19, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 36, name: '青木 陸',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,     store: '渋谷店', age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 37, name: '竹内 ゆか',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,     store: '池袋店', age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 38, name: '金子 海斗',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,  store: '渋谷店', age: 24, hourlyRate: 1200, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 39, name: '工藤 美羽',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,  store: '新宿店', age: 20, hourlyRate: 1150, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 40, name: '和田 一輝',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,  store: '池袋店', age: 22, hourlyRate: 1150, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,  note: '出勤前' },
    { id: 41, name: '斎藤 えみか', role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,  store: '渋谷店', age: 21, hourlyRate: 1150, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 42, name: '横山 蓮太',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,  store: '新宿店', age: 25, hourlyRate: 1250, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 43, name: '内田 朱音',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,      store: '渋谷店', age: 23, hourlyRate: 1180, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 44, name: '宮崎 大空',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,      store: '池袋店', age: 20, hourlyRate: 1150, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 45, name: '田村 葉月',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,      store: '新宿店', age: 19, hourlyRate: 1100, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,   note: '出勤前' },
    { id: 46, name: '原田 悠真',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,      store: '渋谷店', age: 26, hourlyRate: 1300, clockIn: null, clockOut: null, breakMin: 0, overtimeMin: 0,  note: '出勤前' },
    { id: 47, name: '松田 柊',     role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,       store: '渋谷店', age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 48, name: '石田 あかり', role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,       store: '新宿店', age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 49, name: '三浦 朝陽',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,          store: '池袋店', age: 20, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
    { id: 50, name: '坂本 ひな',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,          store: '渋谷店', age: 23, hourlyRate: 1180, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '出勤前' },
  ],
  shiftRequests: [],
  // 確定済みシフト（再確定→再公開で反映）
  confirmedShifts: [],
  // 仮割当シフト（公開済みフェーズで「割当確定」を押した分・再確定するまで保留）
  pendingShifts: [],
  // 店舗そのものの状態（営業可否・人員不足など）
  storeState: {
    '渋谷店': 'open',
    '新宿店': 'open',
    '池袋店': 'open',
  },

  // 週単位のシフト状態（旧 shiftPhase の主責務）
  weeklyShiftState: {
    '渋谷店': { current: 'creating' },
    '新宿店': { current: 'creating' },
    '池袋店': { current: 'creating' },
  },

  // 日単位のシフト状態（希望受付・割当中・確定済み・公開済みなど）
  dailyShiftState: {
    '渋谷店': {},
    '新宿店': {},
    '池袋店': {},
  },

  // 互換用：既存UI・テストランナー向けの店舗別シフトフェーズ
  shiftPhase: {
    '渋谷店': 'creating',
    '新宿店': 'creating',
    '池袋店': 'creating',
  },
};

// test-runner.html 互換用。iframe 側から F().DEMO.shiftRequests のように参照できるようにする。
// top-level const は window のプロパティにならないため、明示的に公開する。
if (typeof window !== 'undefined') {
  window.DEMO = DEMO;
}

/* ═══════════════════════════════════════
   グローバル状態
═══════════════════════════════════════ */
let appState = {
  currentState:  STATES.LOGGED_OUT,
  currentRole:   null,
  currentStaff:  null,   // ログイン中スタッフオブジェクト（DEMO.staffへの参照）
  loginFailures: 0,
  sessionExpiry: null,
  wifiConnected: true,
  workStart:     null,   // Date オブジェクト
  breakStart:    null,   // Date オブジェクト
  transitionLog: [],
};

/* ═══════════════════════════════════════
   ヘルパー
═══════════════════════════════════════ */
function now() { return new Date(); }
function hhmm(date) {
  if (!date) return null;
  return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
}

function addMonthsForDisplay(baseDate, offsetMonths) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth() + offsetMonths, 1);
  return d;
}
function formatYearMonthJP(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}
function formatFullDateJP(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}
function getShiftTargetDate(baseDate = new Date()) {
  // 勤務希望の業務ルール:
  // 25日までは翌月分、26日以降は翌々月分を提出対象にする。
  const offset = baseDate.getDate() <= 25 ? 1 : 2;
  return addMonthsForDisplay(baseDate, offset);
}
function getShiftTargetMonthJP(baseDate = new Date()) {
  return formatYearMonthJP(getShiftTargetDate(baseDate));
}
function getShiftRequestDeadlineDate(baseDate = new Date()) {
  // 締切は「対象月の前月25日」。
  const target = getShiftTargetDate(baseDate);
  return new Date(target.getFullYear(), target.getMonth() - 1, 25);
}
function getShiftRequestDeadlineJP(baseDate = new Date()) {
  return formatFullDateJP(getShiftRequestDeadlineDate(baseDate));
}
function getShiftTargetDefaultDateISO(baseDate = new Date()) {
  // 入力欄の初期値は対象月5日。
  const target = getShiftTargetDate(baseDate);
  const d = new Date(target.getFullYear(), target.getMonth(), 5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getTodayISO(baseDate = new Date()) {
  return `${baseDate.getFullYear()}-${String(baseDate.getMonth() + 1).padStart(2, '0')}-${String(baseDate.getDate()).padStart(2, '0')}`;
}
function findShiftForStaffByDate(staffId, dateISO = getTodayISO()) {
  if (!staffId || !dateISO) return null;
  const sources = [
    ...(DEMO.confirmedShifts || []),
    ...(DEMO.pendingShifts || []),
  ];
  return sources.find(s => Number(s.staffId) === Number(staffId) && s.date === dateISO) || null;
}
function formatShiftForDisplay(shift, staff) {
  if (!shift) return '本日シフトなし';
  const store = staff?.store || '';
  const start = shift.start || '--:--';
  const end = shift.end || '--:--';
  return `${store} ${start}〜${end}`;
}


function parseHHMM(str) {
  if (!str) return null;
  const [h, m] = str.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}
function minutesBetween(from, to) {
  return Math.round((to - from) / 60000);
}
function fmtMinutes(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? `${h}時間${m > 0 ? m + '分' : ''}` : `${m}分`;
}
// スタッフオブジェクトを直接書き換えて一覧にも反映
function updateStaff(patch) {
  if (!appState.currentStaff) return;
  Object.assign(appState.currentStaff, patch);
}


// テストランナーやデモジャンプで状態だけを直接変更した場合でも、
// 「出勤中/休憩中なのに clockIn がない」不整合を起こさないための補正。
function ensureClockConsistencyForStaff(staff, nextState = staff?.state) {
  if (!staff) return false;

  const needsClockIn = nextState === STATES.WORKING || nextState === STATES.ON_BREAK;
  const needsClosedAttendance = nextState === STATES.ATTENDANCE_PENDING || nextState === STATES.SALARY_PENDING;

  if (needsClockIn) {
    if (!staff.clockIn) {
      const base = (appState.currentStaff?.id === staff.id && appState.workStart)
        ? appState.workStart
        : now();
      staff.clockIn = hhmm(base);
    }
    staff.clockOut = null;

    if (appState.currentStaff?.id === staff.id) {
      appState.workStart = parseHHMM(staff.clockIn) || appState.workStart || now();
      if (nextState === STATES.ON_BREAK && !appState.breakStart) appState.breakStart = now();
    }
  }

  // 勤怠未確定・給与未計算は「勤務が終了している」状態なので、
  // テストランナーの直接ジャンプでも clockIn / clockOut を必ず補完する。
  if (needsClosedAttendance) {
    if (!staff.clockIn) {
      const endBase = now();
      const startBase = new Date(endBase.getTime() - 8 * 3600000);
      staff.clockIn = hhmm(startBase);
    }
    if (!staff.clockOut) {
      const start = parseHHMM(staff.clockIn);
      const endBase = start ? new Date(start.getTime() + 8 * 3600000) : now();
      staff.clockOut = hhmm(endBase);
    }

    // 直接ジャンプ・テスト補完などで clockIn と clockOut が同時刻/逆転した場合は、
    // 最低1分の勤務時間になるように補正する。
    if (staff.clockIn && staff.clockOut) {
      const start = parseHHMM(staff.clockIn);
      const end = parseHHMM(staff.clockOut);
      if (start && end && start.getTime() >= end.getTime()) {
        staff.clockOut = hhmm(new Date(start.getTime() + 60000));
      }
    }

    if (staff.breakMin === undefined || staff.breakMin === null) staff.breakMin = 0;

    if (appState.currentStaff?.id === staff.id) {
      appState.workStart = null;
      appState.breakStart = null;
    }
  }

  return true;
}

function normalizeAllClockConsistency() {
  DEMO.staff.forEach(s => ensureClockConsistencyForStaff(s, s.state));
}


/* ═══════════════════════════════════════
   店舗・週・日単位の状態管理
   - storeState: 店舗そのものの営業/運用状態
   - weeklyShiftState: 週単位のシフト進行状態
   - dailyShiftState: 日単位のシフト進行状態
   - shiftPhase: 既存コード互換用（weeklyShiftState.current と同期）
═══════════════════════════════════════ */
const STORE_STATES = {
  OPEN: 'open',
  TEMPORARY_CLOSED: 'temporary_closed',
  STAFF_SHORTAGE: 'staff_shortage',
  RECRUITING: 'recruiting',
  SHIFT_LOCKED: 'shift_locked',
};

const WEEKLY_SHIFT_STATES = {
  COLLECTING_REQUESTS: 'collecting_requests',
  CREATING: 'creating',
  NEEDS_REVIEW: 'needs_review',
  CONFIRMED: 'confirmed',
  PUBLISHED: 'published',
  IN_OPERATION: 'in_operation',
  CLOSED: 'closed',
};

const DAILY_SHIFT_STATES = {
  DRAFT: 'draft',
  REQUESTED: 'requested',
  ASSIGNING: 'assigning',
  CONFIRMED: 'confirmed',
  PUBLISHED: 'published',
  STAFF_SHORTAGE: 'staff_shortage',
  CLOSED: 'closed',
  ATTENDANCE_PENDING: 'attendance_pending',
  ATTENDANCE_FIXED: 'attendance_fixed',
};

function ensureStoreState(store) {
  if (!store) return;
  if (!DEMO.storeState) DEMO.storeState = {};
  if (!DEMO.weeklyShiftState) DEMO.weeklyShiftState = {};
  if (!DEMO.dailyShiftState) DEMO.dailyShiftState = {};
  if (!DEMO.shiftPhase) DEMO.shiftPhase = {};

  if (!DEMO.storeState[store]) DEMO.storeState[store] = STORE_STATES.OPEN;
  if (!DEMO.weeklyShiftState[store]) DEMO.weeklyShiftState[store] = { current: WEEKLY_SHIFT_STATES.CREATING };
  if (!DEMO.dailyShiftState[store]) DEMO.dailyShiftState[store] = {};
  if (!DEMO.shiftPhase[store]) DEMO.shiftPhase[store] = DEMO.weeklyShiftState[store].current || WEEKLY_SHIFT_STATES.CREATING;
}

function getStoreState(store) {
  ensureStoreState(store);
  return DEMO.storeState?.[store] || STORE_STATES.OPEN;
}

function setStoreState(store, state) {
  ensureStoreState(store);
  if (!store) return null;
  DEMO.storeState[store] = state;
  updateDailyShiftStatesForStore(store);
  return state;
}

function getCurrentWeekKey() {
  // 現段階は既存システム互換のため current を利用。
  // 実運用では YYYY-Wxx 形式のISO週番号に差し替え可能。
  return 'current';
}

function getWeeklyShiftState(store, weekKey = getCurrentWeekKey()) {
  ensureStoreState(store);
  return DEMO.weeklyShiftState?.[store]?.[weekKey] || WEEKLY_SHIFT_STATES.CREATING;
}

function setWeeklyShiftState(store, weekKey, state) {
  ensureStoreState(store);
  if (!store) return null;
  const key = weekKey || getCurrentWeekKey();
  DEMO.weeklyShiftState[store][key] = state;

  // 旧 shiftPhase と互換同期
  if (key === 'current') DEMO.shiftPhase[store] = state;

  updateDailyShiftStatesForStore(store);
  return state;
}

function getDailyShiftState(store, date) {
  ensureStoreState(store);
  if (!date) return DAILY_SHIFT_STATES.DRAFT;
  return DEMO.dailyShiftState?.[store]?.[date] || DAILY_SHIFT_STATES.DRAFT;
}

function setDailyShiftState(store, date, state) {
  ensureStoreState(store);
  if (!store || !date) return null;
  DEMO.dailyShiftState[store][date] = state;
  return state;
}

function getShiftPhase(store) {
  return getWeeklyShiftState(store, 'current');
}

function setShiftPhase(store, phase) {
  return setWeeklyShiftState(store, 'current', phase);
}

function getStoreDates(store) {
  const dates = new Set();

  (DEMO.shiftRequests || []).forEach(r => {
    const s = DEMO.staff.find(st => st.id === r.staffId);
    if (s?.store === store && r.date) dates.add(r.date);
  });

  (DEMO.confirmedShifts || []).forEach(c => {
    const s = DEMO.staff.find(st => st.id === c.staffId);
    if (s?.store === store && c.date) dates.add(c.date);
  });

  (DEMO.pendingShifts || []).forEach(p => {
    const s = DEMO.staff.find(st => st.id === p.staffId);
    if (s?.store === store && p.date) dates.add(p.date);
  });

  return [...dates].sort();
}

function countConfirmedByStoreDate(store, date) {
  return (DEMO.confirmedShifts || []).filter(c => {
    const s = DEMO.staff.find(st => st.id === c.staffId);
    return s?.store === store && c.date === date;
  }).length;
}

function countPendingByStoreDate(store, date) {
  return (DEMO.pendingShifts || []).filter(p => {
    const s = DEMO.staff.find(st => st.id === p.staffId);
    return s?.store === store && p.date === date;
  }).length;
}

function countRequestsByStoreDate(store, date) {
  return (DEMO.shiftRequests || []).filter(r => {
    const s = DEMO.staff.find(st => st.id === r.staffId);
    return s?.store === store && r.date === date;
  }).length;
}

function updateDailyShiftStatesForStore(store) {
  ensureStoreState(store);
  if (!store) return;

  const phase = getShiftPhase(store);
  const dates = getStoreDates(store);

  dates.forEach(date => {
    const reqCount = countRequestsByStoreDate(store, date);
    const confirmedCount = countConfirmedByStoreDate(store, date);
    const pendingCount = countPendingByStoreDate(store, date);

    if (getStoreState(store) === STORE_STATES.TEMPORARY_CLOSED) {
      setDailyShiftState(store, date, DAILY_SHIFT_STATES.CLOSED);
    } else if (phase === WEEKLY_SHIFT_STATES.PUBLISHED && confirmedCount > 0) {
      setDailyShiftState(store, date, DAILY_SHIFT_STATES.PUBLISHED);
    } else if (phase === WEEKLY_SHIFT_STATES.CONFIRMED && confirmedCount > 0) {
      setDailyShiftState(store, date, DAILY_SHIFT_STATES.CONFIRMED);
    } else if (confirmedCount > 0 || pendingCount > 0) {
      setDailyShiftState(store, date, DAILY_SHIFT_STATES.ASSIGNING);
    } else if (reqCount > 0) {
      setDailyShiftState(store, date, DAILY_SHIFT_STATES.REQUESTED);
    } else {
      setDailyShiftState(store, date, DAILY_SHIFT_STATES.DRAFT);
    }
  });
}

function updateDailyShiftStatesForAllStores() {
  const stores = new Set(DEMO.staff.map(s => s.store).filter(Boolean));
  Object.keys(DEMO.storeState || {}).forEach(store => stores.add(store));
  stores.forEach(store => updateDailyShiftStatesForStore(store));
}

function getStoreOperationalSnapshot(store) {
  ensureStoreState(store);
  return {
    store,
    storeState: getStoreState(store),
    weeklyShiftState: JSON.parse(JSON.stringify(DEMO.weeklyShiftState?.[store] || {})),
    dailyShiftState: JSON.parse(JSON.stringify(DEMO.dailyShiftState?.[store] || {})),
    shiftPhase: getShiftPhase(store),
  };
}

/* ═══════════════════════════════════════
   状態機械
═══════════════════════════════════════ */
function transition(eventName, payload = {}) {
  const route = EVENT_ROUTES[eventName];
  if (!route) { logT(eventName, 'ERROR: event_routesに存在しないイベント'); return false; }
  if (!route.from.includes(appState.currentState)) { logT(eventName, `ERROR: ${appState.currentState}からこのイベントは発火不可`); return false; }
  if (appState.currentRole && !route.roles.includes(appState.currentRole)) { logT(eventName, 'ERROR: 権限外イベント'); return false; }

  const prev = appState.currentState;

  switch (eventName) {
    case 'LOGIN':
      if (!doLogin(payload)) return false;
      // doLogin内でセットした_loginTargetStateをroute.toより優先する
      if (appState._loginTargetState) {
        appState.currentState = appState._loginTargetState;
        appState._loginTargetState = null;
        updateStaff({ state: appState.currentState });
        logT('LOGIN', `${appState.currentStaff?.name} ログイン → ${appState.currentState}`);
        updateGuideOnStateChange();
        return true;
      }
      break;
    case 'SHIFT_REQUEST_SUBMIT': if (!doShiftSubmit(payload)) return false; break;
    case 'SHIFT_CONFIRM':        if (!doShiftConfirm()) return false; break;
    case 'SHIFT_PUBLISH':        doShiftPublish(); break;
    case 'CLOCK_IN':           doClockin(); break;
    case 'BREAK_START':        doBreakStart(); break;
    case 'BREAK_END':          doBreakEnd(); break;
    case 'CLOCK_OUT':          doClockout(); break;
    case 'OVERTIME_APPLY':     doOvertimeApply(payload); break;
    case 'ATTENDANCE_CONFIRM': doAttendanceConfirm(); break;
  }

  appState.currentState = route.to;
  updateStaff({ state: route.to });
  if (appState.currentStaff) ensureClockConsistencyForStaff(appState.currentStaff, route.to);
  logT(eventName, `${prev} → ${route.to}`);
  updateGuideOnStateChange();
  return true;
}

// ─── 打刻可否制御 ─────────────────────────
function updateClockButtons() {
    const staff = appState.currentStaff;
    if (!staff) return;

    const isPartTime = appState.currentRole === ROLES.PART_TIME;
    const todayShift = findShiftForStaffByDate(staff?.id, getTodayISO());
    const storeOpen = getStoreState(staff.store) === STORE_STATES.OPEN;
    // アルバイトはシフト必須、店長・管理者はシフト不問
    const shiftOk = isPartTime ? todayShift !== null : true;

    const canClockIn   = appState.currentState === STATES.PRE_WORK   && shiftOk && storeOpen;
    const canBreakStart= appState.currentState === STATES.WORKING     && shiftOk && storeOpen;
    const canBreakEnd  = appState.currentState === STATES.ON_BREAK    && shiftOk && storeOpen;
    const canClockOut  = appState.currentState === STATES.WORKING     && shiftOk && storeOpen;

    const btnClockIn = document.getElementById('btn-clock-in');
    const btnBreakStart = document.getElementById('btn-break-start');
    const btnBreakEnd = document.getElementById('btn-break-end');
    const btnClockOut = document.getElementById('btn-clock-out');

    if(btnClockIn) btnClockIn.disabled = !canClockIn;
    if(btnBreakStart) btnBreakStart.disabled = !canBreakStart;
    if(btnBreakEnd) btnBreakEnd.disabled = !canBreakEnd;
    if(btnClockOut) btnClockOut.disabled = !canClockOut;
}

// 状態変更時に更新
const old_transition = transition;
transition = function(eventName, payload = {}) {
    const result = old_transition(eventName, payload);
    updateClockButtons();
    return result;
}



/* ─── 各操作の実処理 ─── */
function doLogin({ staffId, password }) {
  if (appState.loginFailures >= RULES.MAX_LOGIN_FAILURES) {
    showError('アカウントがロックされています。管理者へ連絡してください。'); return false;
  }
  if (!staffId) {
    showError('スタッフを選択してください。'); return false;
  }
  if (!password) {
    appState.loginFailures++;
    showError(`パスワードを入力してください（失敗 ${appState.loginFailures}/${RULES.MAX_LOGIN_FAILURES}回）`); return false;
  }
  const staff = DEMO.staff.find(s => s.id === Number(staffId));
  if (!staff) { showError('スタッフが見つかりません。'); return false; }

  appState.currentStaff  = staff;
  appState.currentRole   = staff.role;
  appState.loginFailures = 0;
  appState.sessionExpiry = new Date(Date.now() + RULES.SESSION_HOURS * 3600 * 1000);

  // 出勤中ならworkStartを復元
  appState.workStart  = null;
  appState.breakStart = null;
  if (staff.clockIn && !staff.clockOut) {
    appState.workStart = parseHHMM(staff.clockIn);
  }
  if (staff.state === STATES.ON_BREAK && staff.clockIn) {
    appState.workStart  = parseHHMM(staff.clockIn);
    appState.breakStart = new Date(Date.now() - (staff.breakMin || 10) * 60000);
  }

  // ロール別のログイン後初期状態を決定
  const defaultStateByRole = {
    [ROLES.ADMIN]:     STATES.ATTENDANCE_PENDING, // 管理者 → 勤怠確定が最初の仕事
    [ROLES.MANAGER]:   STATES.SHIFT_CREATING,     // 店長 → シフト作成が最初の仕事
    [ROLES.PART_TIME]: STATES.SHIFT_REQ_PENDING,  // アルバイト → 勤務希望提出
  };
  // スタッフ自身の state が LOGGED_OUT 以外なら優先、そうでなければロール別デフォルト
  const targetState = staff.state !== STATES.LOGGED_OUT
    ? staff.state
    : (defaultStateByRole[staff.role] || STATES.SHIFT_REQ_PENDING);
  appState._loginTargetState = targetState;
  return true;
}

function doShiftConfirm() {
  const store = appState.currentStaff?.store;
  if (!DEMO.pendingShifts) DEMO.pendingShifts = [];

  // 仮割当分を confirmedShifts にマージ
  const storePending = DEMO.pendingShifts.filter(p => {
    const s = DEMO.staff.find(s => s.id === p.staffId);
    return s?.store === store;
  });
  storePending.forEach(p => {
    const already = DEMO.confirmedShifts.find(c => c.date === p.date && c.staffId === p.staffId);
    if (!already) DEMO.confirmedShifts.push(p);
  });
  // マージした仮割当を pendingShifts から除去
  DEMO.pendingShifts = DEMO.pendingShifts.filter(p => {
    const s = DEMO.staff.find(s => s.id === p.staffId);
    return s?.store !== store;
  });

  const count = (DEMO.confirmedShifts || []).filter(c => {
    const s = DEMO.staff.find(s => s.id === c.staffId);
    return s?.store === store;
  }).length;
  if (count === 0) {
    showError('割当確定されたシフトが0件です。シフト作成画面で「割当確定」を押してください。');
    return false;
  }
  if (store && DEMO.shiftPhase) {
    setShiftPhase(store, WEEKLY_SHIFT_STATES.CONFIRMED);
  }
  updateStaff({ note: `${store} 8月シフト確定済み` });
  return true;
}

function doShiftPublish() {
  const store = appState.currentStaff?.store;
  if (store && DEMO.shiftPhase) {
    setShiftPhase(store, WEEKLY_SHIFT_STATES.PUBLISHED);
  }
  updateStaff({ note: `${store} 8月シフト公開済み` });

  // 公開対象のアルバイト全員の state を SHIFT_PUBLISHED に更新
  const confirmedIds = new Set((DEMO.confirmedShifts || []).map(c => c.staffId));
  DEMO.staff.forEach(s => {
    if (confirmedIds.has(s.id)) {
      s.state = STATES.SHIFT_PUBLISHED;
      const prevNote = s.note || '';
      s.note = prevNote.includes('公開') ? prevNote : prevNote + ' → シフト公開済み';
    }
  });
  // confirmedShiftsにいないが同店舗の提出済みスタッフは「希望提出済み・割当なし」のまま
  logT('SHIFT_PUBLISH', `${store} のシフトを公開。対象${confirmedIds.size}名`);
}

function addShiftRequest() {
  /* 「希望日を追加」ボタン用：重複チェックしてリストに追加するだけ（state遷移なし） */
  const staffId = Number(appState.currentStaff?.id);
  if (!staffId) return;
  const date  = document.getElementById('inp-shift-date')?.value  || getShiftTargetDefaultDateISO();
  const start = document.getElementById('inp-shift-start')?.value || '10:00';
  const end   = document.getElementById('inp-shift-end')?.value   || '18:00';
  if (!date || !start || !end) { showError('日付・時間を入力してください'); return; }
  if (start >= end) { showError('終了時間は開始時間より後にしてください'); return; }
  const dup = DEMO.shiftRequests.find(r => r.staffId === staffId && r.date === date);
  if (dup) { showError(`${date} はすでに登録されています`); return; }
  DEMO.shiftRequests.push({ staffId, date, start, end });
  const store = appState.currentStaff?.store;
  if (store) updateDailyShiftStatesForStore(store);
  showToast(`${date} ${start}〜${end} を追加しました`);
  renderMainView(); // 一覧を再描画（state遷移なし）
}

function doShiftSubmit(payload) {
  /* 「提出して完了する」ボタン用：shiftRequestsに1件以上あれば SHIFT_REQ_SUBMITTED へ */
  const staffId = appState.currentStaff?.id;
  const myReqs  = DEMO.shiftRequests.filter(r => r.staffId === staffId);
  if (myReqs.length === 0) {
    showError('希望日を1件以上追加してから提出してください');
    return false;
  }
  updateStaff({ note: `${myReqs.length}件提出済み` });
  return true;
}

function doClockin() {
  const role = appState.currentRole;
  // ─── シフト有無チェック（アルバイトのみ） ────────────────────
  if (role === ROLES.PART_TIME) {
    const todayShift = findShiftForStaffByDate(appState.currentStaff?.id, getTodayISO());
    if (!todayShift) {
      showError('本日のシフトがありません。打刻できません。シフトに誤りがある場合は店長へご連絡ください。');
      return;
    }
  }
  // ─── 店舗営業状態チェック ─────────────────────────────────────
  if (getStoreState(appState.currentStaff?.store) !== STORE_STATES.OPEN) {
    showError('現在、店舗が営業していません。打刻できません。'); return;
  }
  if (RULES.WIFI_REQUIRED && !appState.wifiConnected && !RULES.OFFLINE_CLOCK_IN) {
    showError('店舗Wi-Fiに接続されていません。'); return;
  }
  if (appState.currentStaff?.isMinor && isLateNight()) {
    showError('18歳未満の深夜勤務は禁止されています。'); return;
  }
  appState.workStart = now();
  const t = hhmm(appState.workStart);
  updateStaff({ clockIn: t, clockOut: null, breakMin: 0, overtimeMin: 0, note: `${t} 出勤打刻` });
}

function doBreakStart() {
  appState.breakStart = now();
  updateStaff({ note: `${hhmm(appState.breakStart)} 休憩開始` });
}

function doBreakEnd() {
  const added = appState.breakStart ? minutesBetween(appState.breakStart, now()) : 0;
  appState.breakStart = null;
  const total = (appState.currentStaff?.breakMin || 0) + added;
  updateStaff({ breakMin: total, note: `休憩累計 ${total}分` });
}

function doClockout() {
  const t = hhmm(now());
  const workMin = appState.workStart ? minutesBetween(appState.workStart, now()) : 0;
  const breakMin = appState.currentStaff?.breakMin || 0;
  const actualMin = workMin - breakMin;
  updateStaff({ clockOut: t, note: `退勤 ${t} 実働${fmtMinutes(actualMin)}` });
}

function doOvertimeApply(payload) {
  const reason = document.getElementById('inp-overtime-reason')?.value || payload.reason || '';
  const min    = Number(document.getElementById('inp-overtime-min')?.value || 60);
  updateStaff({ overtimeMin: min, note: `残業${min}分申請: ${reason || '理由未記入'}` });
}

function doAttendanceConfirm() {
  const s = appState.currentStaff;
  if (!s) return;
  const workMin   = calcWorkMin(s);
  const salaryEst = s.hourlyRate ? Math.round(s.hourlyRate * workMin / 60) : null;
  updateStaff({ note: `勤怠確定 実働${fmtMinutes(workMin)}${salaryEst ? ' 概算¥' + salaryEst.toLocaleString() : ''}` });
}

function calcWorkMin(s) {
  if (!s || !s.clockIn || !s.clockOut) return 0;
  const [sh, sm] = s.clockIn.split(':').map(Number);
  const [eh, em] = s.clockOut.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm) - (s.breakMin || 0);
}

function isLateNight() {
  const h = new Date().getHours();
  return h >= 22 || h < 5;
}

/* ─── LOGINの状態上書き（スタッフの現在状態を優先） ─── */
const _origTransition = transition;
// transition内でroute.toを設定した後にスタッフ状態を上書きするため
// doLoginで保存した _loginTargetState をupdateGuideOnStateChange前に適用
const _originalUpdate = updateGuideOnStateChange;

// transition()の末尾でcurrentStateをスタッフ状態に戻す
// → event_routesのtoはSHIFT_REQ_PENDINGだが実際はスタッフの現在状態
// 実装: doLogin内で_loginTargetStateを設定し、transition()末尾で上書き
const _realTransition = transition;
// パッチ: LOGINイベント後にスタッフの実状態へ戻す
function patchedTransition(eventName, payload = {}) {
  return transition(eventName, payload);
}

/* ═══════════════════════════════════════
   状態進行モデル
═══════════════════════════════════════ */
/* ── ロール別進捗モデル ───────────────────────────────
   アルバイト : 希望提出 → シフト確認 → 出退勤
   店長       : シフト作成 → 確定・公開 → 勤怠確定
   管理者     : シフト管理 → 勤怠確定 → 給与計算
   未ログイン : ログインのみ
────────────────────────────────────────────────── */
const PROGRESS_MODELS = {
  [ROLES.PART_TIME]: [
    { state: STATES.LOGGED_OUT,          label: 'ログイン',     icon: 'ti-login' },
    { state: STATES.SHIFT_REQ_PENDING,   label: '希望提出',     icon: 'ti-calendar-event' },
    { state: STATES.SHIFT_REQ_SUBMITTED, label: '提出済み',     icon: 'ti-calendar-check' },
    { state: STATES.SHIFT_PUBLISHED,     label: 'シフト確認',   icon: 'ti-eye' },
    { state: STATES.PRE_WORK,            label: '出勤前',       icon: 'ti-clock' },
    { state: STATES.WORKING,             label: '出勤中',       icon: 'ti-briefcase' },
    { state: STATES.ON_BREAK,            label: '休憩中',       icon: 'ti-coffee' },
    { state: STATES.ATTENDANCE_PENDING,  label: '勤怠確認',     icon: 'ti-clipboard-check' },
  ],
  [ROLES.MANAGER]: [
    { state: STATES.LOGGED_OUT,          label: 'ログイン',     icon: 'ti-login' },
    { state: STATES.SHIFT_CREATING,      label: 'シフト作成',   icon: 'ti-layout-grid' },
    { state: STATES.SHIFT_CONFIRMED,     label: 'シフト確定',   icon: 'ti-circle-check' },
    { state: STATES.SHIFT_PUBLISHED,     label: 'シフト公開',   icon: 'ti-eye' },
    { state: STATES.PRE_WORK,            label: '自分の打刻',   icon: 'ti-clock' },
    { state: STATES.ATTENDANCE_PENDING,  label: '勤怠確定',     icon: 'ti-clipboard-check' },
  ],
  [ROLES.ADMIN]: [
    { state: STATES.LOGGED_OUT,          label: 'ログイン',     icon: 'ti-login' },
    { state: STATES.SHIFT_CREATING,      label: 'シフト管理',   icon: 'ti-layout-grid' },
    { state: STATES.ATTENDANCE_PENDING,  label: '勤怠確定',     icon: 'ti-clipboard-check' },
    { state: STATES.SALARY_PENDING,      label: '給与計算',     icon: 'ti-coin' },
  ],
  null: [
    { state: STATES.LOGGED_OUT,          label: 'ログイン',     icon: 'ti-login' },
  ],
};

function getProgressModel() {
  return PROGRESS_MODELS[appState.currentRole] || PROGRESS_MODELS[null];
}

function getCurrentProgress() {
  const model = getProgressModel();
  const idx = model.findIndex(s => s.state === appState.currentState);
  const i = idx < 0 ? 0 : idx;
  return { idx: i, total: model.length, pct: Math.round(i / Math.max(model.length - 1, 1) * 100), model };
}

function getNextAction() {
  const role = appState.currentRole;

  // ロール別CTA
  const byRole = {
    [ROLES.PART_TIME]: {
      [STATES.LOGGED_OUT]:          { cta: 'ログインしてください',         warn: null },
      [STATES.SHIFT_REQ_PENDING]:   { cta: '勤務希望を提出してください',   warn: '締切後は編集できません' },
      [STATES.SHIFT_REQ_SUBMITTED]: { cta: 'シフト公開をお待ちください',   warn: null },
      [STATES.SHIFT_PUBLISHED]:     { cta: '確定シフトを確認してください', warn: null },
      [STATES.PRE_WORK]:            { cta: '出勤打刻してください',         warn: appState.wifiConnected ? null : '店舗Wi-Fi未接続' },
      [STATES.WORKING]:             { cta: '勤務中です',                   warn: overtimeWarn() },
      [STATES.ON_BREAK]:            { cta: '休憩終了してください',         warn: null },
      [STATES.OVERTIME_APPLYING]:   { cta: '残業申請を送信してください',   warn: null },
      [STATES.ABSENCE_APPLYING]:    { cta: '欠勤申請を完了してください',   warn: null },
      [STATES.REPLACEMENT_OPEN]:    { cta: '代替シフトへ応募できます',     warn: null },
      [STATES.ATTENDANCE_PENDING]:  { cta: '勤怠内容を確認してください',   warn: null },
    },
    [ROLES.MANAGER]: {
      [STATES.LOGGED_OUT]:          { cta: 'ログインしてください',               warn: null },
      [STATES.SHIFT_CREATING]:      { cta: 'スタッフのシフトを作成してください', warn: null },
      [STATES.SHIFT_CONFIRMED]:     { cta: 'シフトを公開してください',           warn: null },
      [STATES.SHIFT_PUBLISHED]:     { cta: 'シフトを公開済みです',               warn: null },
      [STATES.PRE_WORK]:            { cta: '自分の出勤打刻をしてください',       warn: appState.wifiConnected ? null : '店舗Wi-Fi未接続' },
      [STATES.WORKING]:             { cta: '勤務中です',                         warn: overtimeWarn() },
      [STATES.ON_BREAK]:            { cta: '休憩終了してください',               warn: null },
      [STATES.ATTENDANCE_PENDING]:  { cta: 'スタッフの勤怠を確定してください',   warn: null },
    },
    [ROLES.ADMIN]: {
      [STATES.LOGGED_OUT]:          { cta: 'ログインしてください',             warn: null },
      [STATES.SHIFT_CREATING]:      { cta: 'シフト管理を確認してください',     warn: null },
      [STATES.ATTENDANCE_PENDING]:  { cta: 'スタッフの勤怠を確定してください', warn: null },
      [STATES.SALARY_PENDING]:      { cta: '給与計算を実行してください',       warn: null },
      [STATES.NOTIFY_FAILED]:       { cta: '通知を再送してください',           warn: '通知送信に失敗しています' },
      [STATES.PRE_WORK]:            { cta: '自分の出勤打刻をしてください',     warn: null },
      [STATES.WORKING]:             { cta: '勤務中です',                       warn: overtimeWarn() },
    },
  };

  const roleGuide = byRole[role] || byRole[ROLES.PART_TIME];
  return roleGuide[appState.currentState] || { cta: 'ログインしてください', warn: null };
}

function overtimeWarn() {
  if (!appState.workStart) return null;
  const min = minutesBetween(appState.workStart, now()) - (appState.currentStaff?.breakMin || 0);
  return min > RULES.OVERTIME_HOURS * 60 ? `実働${fmtMinutes(min)}：残業申請が必要です` : null;
}

/* ═══════════════════════════════════════
   レンダリング
═══════════════════════════════════════ */
function updateGuideOnStateChange() {
  renderSidebar();
  renderStatePanel();
  renderProgressStepper();
  renderGuide();
  renderMainView();
  highlightNextTab();
  renderStaffListIfAllowed();
  // renderMainView()でDOMが再生成されるため、打刻ボタン状態を必ず再評価
  updateClockButtons();
}

/* スタッフ一覧は店長・管理者のみ表示 */
function renderStaffListIfAllowed() {
  const panel = document.getElementById('staff-list-panel');
  if (!panel) return;
  const role = appState.currentRole;
  if (role === ROLES.MANAGER || role === ROLES.ADMIN) {
    panel.style.display = '';
    renderStaffList();
  } else {
    panel.style.display = 'none';
  }
}

function renderStatePanel() {
  const el = document.getElementById('state-panel');
  if (!el) return;
  const s    = appState.currentStaff;
  const role = appState.currentRole;

  if (!role) {
    // 未ログイン
    el.innerHTML = `<span class="role-badge role-none"><i class="ti ti-user-off"></i>未ログイン</span>`;
    return;
  }

  const ROLE_BADGE = {
    [ROLES.ADMIN]:      '<span class="role-badge role-admin"><i class="ti ti-shield-check"></i>管理者</span>',
    [ROLES.MANAGER]:    '<span class="role-badge role-manager"><i class="ti ti-crown"></i>店長</span>',
    [ROLES.PART_TIME]:  '<span class="role-badge role-part"><i class="ti ti-user"></i>アルバイト</span>',
  };

  const badge   = ROLE_BADGE[role] || '';
  const whoHtml = s ? `<span class="state-who"><i class="ti ti-door-enter"></i>${s.name}（${s.store}）</span>` : '';
  const sess    = appState.sessionExpiry ? `セッション期限 ${appState.sessionExpiry.toLocaleTimeString('ja-JP')}` : '';

  el.innerHTML = `
    <div class="state-current">
      ${badge}
      ${whoHtml}
      <span class="state-badge">${appState.currentState}</span>
      ${sess ? `<span class="state-meta">${sess}</span>` : ''}
    </div>`;
}

function renderProgressStepper() {
  const el = document.getElementById('progress-stepper');
  if (!el) return;
  const { idx, model } = getCurrentProgress();
  el.innerHTML = model.map((step, i) => {
    const cls = i === idx ? 'step active' : i < idx ? 'step done' : 'step pending';
    const dot = i < idx
      ? `<span class="step-badge"><i class="ti ti-check"></i></span>`
      : `<i class="ti ${step.icon}"></i>`;
    return `<div class="${cls}"><div class="step-dot">${dot}</div><div class="step-label">${step.label}</div></div>`
           + (i < model.length - 1 ? '<div class="step-line"></div>' : '');
  }).join('');
}

function renderGuide() {
  const el = document.getElementById('guide-box');
  if (!el) return;
  const { pct, idx, model } = getCurrentProgress();
  const guide = getNextAction();
  const s = appState.currentStaff;
  const who = s ? `<span class="guide-who">${s.name}さん</span>` : '';
  const warn = guide.warn ? `<div class="warn-box"><i class="ti ti-alert-triangle"></i> ${guide.warn}</div>` : '';
  el.innerHTML = `
    <div class="guide-cta">${who}${guide.cta}</div>
    ${warn}
    <div class="guide-progress-bar"><div class="guide-progress-fill" style="width:${pct}%"></div></div>
    <div class="guide-progress-label">進捗 ${pct}%（ステップ ${idx + 1} / ${model.length}）</div>`;
}

function renderMainView() {
  const el = document.getElementById('main-view');
  if (!el) return;
  el.innerHTML = buildView(appState.currentState);
  bindViewEvents();
}

function highlightNextTab() {
  /* renderSidebar() の後に呼ぶので、DOM上のnav-tabが確定している */
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('next-target'));
  const role = appState.currentRole;
  // 打刻系のタブIDはロールによって異なる
  const clockTabId = (role === ROLES.MANAGER || role === ROLES.ADMIN) ? 'tab-my-clock' : 'tab-attendance';
  const attendTabId = (role === ROLES.MANAGER || role === ROLES.ADMIN) ? 'tab-attendance' : 'tab-attendance';

  const map = {
    [STATES.LOGGED_OUT]:          'tab-login',
    [STATES.SHIFT_REQ_PENDING]:   'tab-shift-req',
    [STATES.SHIFT_CREATING]:      'tab-shift-mgmt',
    [STATES.SHIFT_CONFIRMED]:     'tab-shift-mgmt',
    [STATES.SHIFT_PUBLISHED]:     'tab-shift-check',
    [STATES.PRE_WORK]:            clockTabId,
    [STATES.WORKING]:             clockTabId,
    [STATES.ON_BREAK]:            clockTabId,
    [STATES.OVERTIME_APPLYING]:   clockTabId,
    [STATES.ABSENCE_APPLYING]:    'tab-absence',
    [STATES.REPLACEMENT_OPEN]:    'tab-replace',
    [STATES.ATTENDANCE_PENDING]:  attendTabId,
    [STATES.SALARY_PENDING]:      'tab-salary',
    [STATES.NOTIFY_FAILED]:       'tab-notify',
  };
  const t = document.getElementById(map[appState.currentState]);
  if (t) t.classList.add('next-target');
}

/* ═══════════════════════════════════════
   ビュービルダー
═══════════════════════════════════════ */
function buildView(state) {
  const st = appState.currentStaff;   // 現在のスタッフ（null なら匿名）
  const nm = st ? st.name : 'あなた';

  // ─── ログイン ───────────────────────────────
  if (state === STATES.LOGGED_OUT) {
    const groups = { admin: [], manager: [], part_time: [] };
    DEMO.staff.forEach(s => groups[s.role]?.push(s));
    const opts = (role, label) =>
      groups[role].length
        ? `<optgroup label="${label}">${groups[role].map(s => `<option value="${s.id}">${s.name}（${s.store}）</option>`).join('')}</optgroup>`
        : '';
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-lock"></i> ログイン</h2>
        <p class="view-desc">スタッフを選択してパスワードを入力してください。</p>
        <div class="form-group">
          <label>スタッフ名</label>
          <select id="inp-staff-id">
            <option value="">— 選択してください —</option>
            ${opts('admin','管理者')}${opts('manager','店長')}${opts('part_time','アルバイト')}
          </select>
        </div>
        <div class="form-group">
          <label>パスワード <span class="hint-inline">（デモ：何でもOK）</span></label>
          <input type="password" id="inp-password" placeholder="••••••••" />
        </div>
        <div class="error-box" id="login-error" style="display:none"></div>
        <button class="btn-primary" id="btn-login">ログイン</button>
        <p class="hint">セッション ${RULES.SESSION_HOURS}時間 | 失敗 ${RULES.MAX_LOGIN_FAILURES}回でロック</p>
      </div>`;
  }

  // ─── 勤務希望未提出 ─────────────────────────
  if (state === STATES.SHIFT_REQ_PENDING) {
    const myReqs = DEMO.shiftRequests.filter(r => r.staffId === st?.id);
    const reqRows = myReqs.length
      ? myReqs.map(r => `<div class="shift-row"><span>${r.date}</span><span>${r.start}</span><span>${r.end}</span><span class="badge-warn">希望済</span></div>`).join('')
      : `<div class="shift-row" style="color:var(--color-text-3)"><span colspan="4">まだ登録なし</span></div>`;
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-calendar-event"></i> 勤務希望提出</h2>
        ${staffChip(st)}
        <div class="info-row"><span class="info-label">対象月</span><span>${getShiftTargetMonthJP()}</span></div>
        <div class="info-row"><span class="info-label">締切</span><span class="warn-text">${getShiftRequestDeadlineJP()}</span></div>
        ${st?.hourlyRate ? `<div class="info-row"><span class="info-label">時給</span><span>¥${st.hourlyRate}</span></div>` : ''}
        <div class="shift-table" style="margin-top:8px">
          <div class="shift-row header"><span>希望日</span><span>開始</span><span>終了</span><span>状態</span></div>
          ${reqRows}
        </div>
        <div class="shift-add-form">
          <div class="form-group"><label>希望日</label><input type="date" id="inp-shift-date" value="${getShiftTargetDefaultDateISO()}" /></div>
          <div class="btn-row">
            <div class="form-group" style="flex:1"><label>開始</label><input type="time" id="inp-shift-start" value="10:00" /></div>
            <div class="form-group" style="flex:1"><label>終了</label><input type="time" id="inp-shift-end"   value="18:00" /></div>
          </div>
          <button class="btn-secondary" id="btn-shift-add">＋ 希望日を追加</button>
        </div>
        <button class="btn-primary" id="btn-shift-submit">提出して完了する</button>
        <p class="hint">⚠ 締切（7/25）後は編集できません。同じ日は1件のみ登録可。</p>
      </div>`;
  }

  // ─── 勤務希望提出済 ─────────────────────────
  if (state === STATES.SHIFT_REQ_SUBMITTED) {
    const myReqs = DEMO.shiftRequests.filter(r => r.staffId === st?.id);
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-calendar-check"></i> 勤務希望提出済</h2>
        ${staffChip(st)}
        <div class="badge-success-lg">✓ 提出完了</div>
        <div class="shift-table" style="margin-top:8px">
          <div class="shift-row header"><span>希望日</span><span>開始</span><span>終了</span><span></span></div>
          ${myReqs.map(r => `<div class="shift-row"><span>${r.date}</span><span>${r.start}</span><span>${r.end}</span><span class="badge-warn">希望済</span></div>`).join('') || '<div class="shift-row"><span style="color:var(--color-text-3)">データなし</span></div>'}
        </div>
        <div class="info-row" style="font-size:13px;color:var(--color-text-2);margin-top:4px">
          <i class="ti ti-info-circle" style="color:var(--color-primary);margin-right:4px"></i>
          「希望済」は勤務希望として提出済みの状態です。店長がシフトに割り当てて公開して初めて「確定シフト」になります。
        </div>
        <p class="hint">公開後に「シフト確認」から確定シフトをご確認ください。</p>
      </div>`;
  }

  // ─── シフト作成中 ───────────────────────────
  if (state === STATES.SHIFT_CREATING) {
    const myStore   = st?.store;
    const DOW       = ['日','月','火','水','木','金','土'];
    const phase     = getShiftPhase(myStore);

    const myPartIds = new Set(
      DEMO.staff.filter(s => s.role === ROLES.PART_TIME && s.store === myStore).map(s => s.id)
    );
    const totalPart      = myPartIds.size;
    const storeReqs      = DEMO.shiftRequests.filter(r => myPartIds.has(r.staffId));
    const submittedCount = new Set(storeReqs.map(r => r.staffId)).size;

    // セクション①：公開済み（confirmedShifts）
    const publishedList = (DEMO.confirmedShifts || [])
      .filter(c => myPartIds.has(c.staffId))
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

    // セクション②：仮割当（pendingShifts）
    const pendingList = (DEMO.pendingShifts || [])
      .filter(p => myPartIds.has(p.staffId))
      .sort((a, b) => a.date.localeCompare(b.date));

    // セクション③：希望済み・未割当
    const takenKeys = new Set([
      ...(DEMO.confirmedShifts || []).map(c => c.date + '_' + c.staffId),
      ...(DEMO.pendingShifts   || []).map(p => p.date + '_' + p.staffId),
    ]);
    const unassignedList = storeReqs
      .filter(r => !takenKeys.has(r.date + '_' + r.staffId))
      .sort((a, b) => a.date.localeCompare(b.date));

    const fmtRow = (date, staffName, start, end, badge) => {
      const d = new Date(date);
      const label = `${date.slice(5).replace('-','/')}(${DOW[d.getDay()]})`;
      return `<div class="shift-row"><span>${label}</span><span>${staffName}</span><span>${start}〜${end}</span><span>${badge}</span></div>`;
    };

    const publishedRows  = publishedList.map(c => fmtRow(c.date, DEMO.staff.find(s=>s.id===c.staffId)?.name||'—', c.start, c.end, '<span class="badge-ok">公開済み</span>'));
    const pendingRows    = pendingList.map(p => fmtRow(p.date, DEMO.staff.find(s=>s.id===p.staffId)?.name||'—', p.start, p.end, '<span class="badge-warn">再確定待ち</span>'));
    const unassignedRows = unassignedList.map(r => fmtRow(r.date, DEMO.staff.find(s=>s.id===r.staffId)?.name||'—', r.start, r.end,
      `<button class="btn-assign" onclick="confirmShift('${r.date}',${r.staffId})">割当確定</button>`));

    const section = (title, rows, color) => rows.length === 0 ? '' : `
      <div class="shift-section-label" style="color:${color};font-size:12px;font-weight:600;letter-spacing:0.04em;margin:12px 0 6px">${title}（${rows.length}件）</div>
      <div class="shift-table" style="margin-bottom:4px">
        <div class="shift-row header"><span>日付</span><span>スタッフ</span><span>時間</span><span>状態</span></div>
        ${rows.join('')}
      </div>`;

    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-layout-grid"></i> シフト割当</h2>
        ${staffChip(st)}
        <div class="info-grid">
          <div class="info-card"><div class="info-num">${submittedCount}</div><div>希望提出スタッフ（全${totalPart}名中）</div></div>
          <div class="info-card"><div class="info-num">${publishedList.length}</div><div>公開済みシフト</div></div>
        </div>
        ${section('✓ 公開済み', publishedRows, 'var(--color-ok)')}
        ${section('⏳ 再確定待ち（仮割当）', pendingRows, 'var(--color-warn)')}
        ${section('📋 希望済み・未割当', unassignedRows, 'var(--color-text-2)')}
        ${publishedList.length + pendingList.length + unassignedList.length === 0
          ? '<div class="warn-box" style="margin-top:12px"><i class="ti ti-info-circle"></i> 勤務希望がまだ提出されていません</div>'
          : ''}
        <div class="btn-row" style="margin-top:12px">
          <button class="btn-secondary" id="btn-shift-draft">一時保存</button>
          <button class="btn-primary" id="btn-shift-confirm">${phase === 'confirmed' || phase === 'published' ? '再確定する' : 'シフトを確定する'}</button>
          ${phase === 'confirmed' ? '<button class="btn-primary" id="btn-shift-publish">スタッフへ公開する</button>' : ''}
        </div>
        ${phase === 'published' && pendingList.length > 0
          ? '<p class="hint warn-text" style="margin-top:6px">⚠ 仮割当があります。「再確定する」→「スタッフへ公開する」で反映されます。</p>'
          : phase === 'published'
            ? '<p class="hint" style="color:var(--color-ok);margin-top:6px">✓ 公開済みです。追加割当→再確定→再公開で追加できます。</p>'
            : '<p class="hint" style="margin-top:6px">割当確定した行が公式シフトになります。確定後に公開してください。</p>'
        }
      </div>`;
  }

  // ─── シフト確定済 ───────────────────────────
  if (state === STATES.SHIFT_CONFIRMED) {
    const myStore  = st?.store;
    // 管理者は全店舗が見えるが、店長は自分の店舗のみ
    const myPartIds = new Set(
      DEMO.staff.filter(s =>
        s.role === ROLES.PART_TIME &&
        (appState.currentRole === ROLES.ADMIN ? true : s.store === myStore)
      ).map(s => s.id)
    );
    const confirmed = (DEMO.confirmedShifts || []).filter(c => myPartIds.has(c.staffId));

    // 日付・スタッフ別に並べる
    const DOW = ['日','月','火','水','木','金','土'];
    const rows = confirmed
      .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
      .map(c => {
        const staff2 = DEMO.staff.find(s => s.id === c.staffId);
        const d      = new Date(c.date);
        const label  = `${c.date.slice(5).replace('-','/')}(${DOW[d.getDay()]})`;
        return `<div class="shift-row">
          <span>${label}</span>
          <span>${staff2?.name || '—'}</span>
          <span>${c.start}〜${c.end}</span>
        </div>`;
      });

    // 日付別の人数サマリ
    const byDate = {};
    confirmed.forEach(c => { byDate[c.date] = (byDate[c.date] || 0) + 1; });
    const dateCount = Object.keys(byDate).length;

    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-circle-check"></i> シフト確定済</h2>
        ${staffChip(st)}
        <div class="badge-success-lg">✓ シフト確定完了</div>
        <div class="info-grid" style="margin-top:8px">
          <div class="info-card">
            <div class="info-num">${confirmed.length}</div>
            <div>確定シフト件数</div>
          </div>
          <div class="info-card">
            <div class="info-num">${new Set(confirmed.map(c=>c.staffId)).size}</div>
            <div>対象スタッフ数</div>
          </div>
        </div>
        ${rows.length > 0 ? `
        <div class="shift-table" style="margin-top:12px">
          <div class="shift-row header"><span>日付</span><span>スタッフ</span><span>時間</span></div>
          ${rows.join('')}
        </div>` : '<div class="warn-box" style="margin-top:8px"><i class="ti ti-alert-triangle"></i> まだ割当確定されたシフトがありません。シフト作成画面で「割当確定」を押してください。</div>'}
        <p class="view-desc" style="margin-top:8px">内容を確認の上、スタッフへ公開してください。</p>
        <button class="btn-primary" id="btn-shift-publish">スタッフへ公開する</button>
      </div>`;
  }

  // ─── シフト公開済 ───────────────────────────
  // この画面はアルバイトが自分の確定シフトを確認する画面。
  // 店長・管理者はシフト公開後にこの状態にはならない。
  if (state === STATES.SHIFT_PUBLISHED) {
    const role = appState.currentRole;

    // 店長・管理者がここに来た場合（デモジャンプ等）は案内を出す
    if (role === ROLES.MANAGER || role === ROLES.ADMIN) {
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-eye"></i> シフト公開済</h2>
          ${staffChip(st)}
          <div class="badge-success-lg">✓ スタッフへ公開完了</div>
          <p class="view-desc">アルバイトスタッフが各自のシフトを確認できる状態です。</p>
          <div class="info-row">
            <span class="info-label">公開対象店舗</span>
            <span>${st?.store || '—'}</span>
          </div>
          <div class="info-row">
            <span class="info-label">公開シフト件数</span>
            <span class="badge-ok">${(DEMO.confirmedShifts || []).filter(c => {
              const s2 = DEMO.staff.find(s => s.id === c.staffId);
              return s2?.store === st?.store;
            }).length}件</span>
          </div>
          <div class="info-row">
            <span class="info-label">対象スタッフ数</span>
            <span>${new Set((DEMO.confirmedShifts || []).filter(c => {
              const s2 = DEMO.staff.find(s => s.id === c.staffId);
              return s2?.store === st?.store;
            }).map(c => c.staffId)).size}名</span>
          </div>
          ${(DEMO.confirmedShifts || []).filter(c => {
            const s2 = DEMO.staff.find(s => s.id === c.staffId);
            return s2?.store === st?.store;
          }).length === 0 ? '<div class="warn-box"><i class="ti ti-alert-triangle"></i> シフト作成画面で「割当確定」ボタンを押してから公開してください</div>' : ''}
          <p class="hint">次のステップ：欠勤申請の受付・代替募集の管理</p>
        </div>`;
    }

    // アルバイト：自分宛の確定シフトを表示
    // phaseがpublishedの場合はconfirmedShiftsが正の数あるはず
    // まだ店長が割当操作をしていない場合は「まだ確定されていません」を表示
    const myStore2 = st?.store;
    const storePhase = getShiftPhase(myStore2);
    const myConfirmed = (DEMO.confirmedShifts || []).filter(c => c.staffId === st?.id);

    const DOW = ['日','月','火','水','木','金','土'];
    const rows = myConfirmed
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(c => {
        const d = new Date(c.date);
        const label = `${c.date.slice(5).replace('-','/')}(${DOW[d.getDay()]})`;
        return `<div class="shift-row">
          <span>${label}</span>
          <span>${c.start}〜${c.end}</span>
          <span>${st?.store || '—'}</span>
        </div>`;
      });

    // 希望済み（未確定）の一覧も表示して状況を分かりやすくする
    const myPending = DEMO.shiftRequests.filter(r => r.staffId === st?.id);
    const confirmedDates = new Set(myConfirmed.map(c => c.date));
    const pendingOnly = myPending.filter(r => !confirmedDates.has(r.date));

    const noShift = rows.length === 0
      ? storePhase === 'published'
        ? `<div class="warn-box"><i class="ti ti-info-circle"></i> あなたの担当シフトはまだ割り当てられていません。店長にご確認ください。</div>`
        : `<div class="warn-box"><i class="ti ti-clock"></i> シフトはまだ公開されていません（現在：${
            storePhase === 'creating' ? '作成中' : '確定済み・公開待ち'
          }）。公開後にここで確認できます。</div>`
      : '';

    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-eye"></i> 確定シフト確認</h2>
        ${staffChip(st)}
        <div class="info-row">
          <span class="info-label">対象月</span><span>${getShiftTargetMonthJP()}</span>
        </div>
        <div class="info-row">
          <span class="info-label">確定件数</span>
          <span class="${rows.length > 0 ? 'badge-ok' : 'badge-warn'}">${rows.length}件</span>
        </div>
        ${noShift}
        ${rows.length > 0 ? `
        <div class="shift-table" style="margin-top:8px">
          <div class="shift-row header"><span>日付</span><span>時間</span><span>店舗</span></div>
          ${rows.join('')}
        </div>` : ''}
        ${rows.length > 0 ? '<button class="btn-warn" id="btn-absence-apply">この中から欠勤申請する</button>' : ''}
        ${pendingOnly.length > 0 ? `
        <div style="margin-top:16px">
          <div style="font-size:12px;font-weight:600;color:var(--color-text-3);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px">
            希望済み・未確定（店長が割り当て次第ここに追加されます）
          </div>
          <div class="shift-table">
            <div class="shift-row header"><span>日付</span><span>希望時間</span><span>状態</span></div>
            ${pendingOnly.sort((a,b)=>a.date.localeCompare(b.date)).map(r => {
              const d = new Date(r.date);
              const DOW2 = ['日','月','火','水','木','金','土'];
              return `<div class="shift-row">
                <span>${r.date.slice(5).replace('-','/')}(${DOW2[d.getDay()]})</span>
                <span>${r.start}〜${r.end}</span>
                <span class="badge-warn">希望済</span>
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}
        <p class="hint">「確定シフト」＝店長が割り当て・公開した正式なシフトです。「希望済」は店長待ちの状態です。</p>
      </div>`;
  }

  // ─── 出勤前 ─────────────────────────────────
  if (state === STATES.PRE_WORK) {
    const wifiOk = appState.wifiConnected;
    const role = appState.currentRole;
    const isPartTime = role === ROLES.PART_TIME;
    const todayShift = findShiftForStaffByDate(st?.id, getTodayISO());
    const shiftText = formatShiftForDisplay(todayShift, st);
    // シフト表示：アルバイトはシフト必須、店長・管理者は参考表示のみ
    const shiftClass = todayShift ? 'badge-ok' : (isPartTime ? 'badge-error' : 'badge-warn');
    const storeOpen = getStoreState(st?.store) === STORE_STATES.OPEN;
    // 打刻可否：アルバイトはシフト必須、店長・管理者はシフト不問（店舗営業中であれば可）
    const clockInEnabled = storeOpen && (isPartTime ? todayShift !== null : true);
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-clock"></i> 出勤前</h2>
        ${staffChip(st)}
        ${(todayShift || isPartTime) ? `<div class="info-row"><span class="info-label">本日シフト</span><span class="${shiftClass}">${shiftText}</span></div>` : ''}
        ${isPartTime && !todayShift ? `<div class="warn-box" style="margin-bottom:12px"><i class="ti ti-calendar-x"></i> <strong>本日のシフトがありません。</strong>打刻できません。<br>シフトに誤りがある場合は店長へご連絡ください。</div>` : ''}
        ${!storeOpen ? `<div class="warn-box" style="margin-bottom:12px"><i class="ti ti-lock"></i> 現在、店舗が営業していません。打刻できません。</div>` : ''}
        <div class="info-row"><span class="info-label">Wi-Fi</span>
          <span class="${wifiOk ? 'badge-ok' : 'badge-error'}">${wifiOk ? '接続中' : '未接続'}</span>
        </div>
        <label class="toggle-row">
          <input type="checkbox" id="chk-wifi" ${wifiOk ? 'checked' : ''} />
          <span>Wi-Fiシミュレート（デモ用）</span>
        </label>
        ${!wifiOk ? '<div class="warn-box"><i class="ti ti-wifi-off"></i> オフライン打刻は後で同期されます</div>' : ''}
        <button class="btn-primary btn-xl" id="btn-clock-in" ${clockInEnabled ? '' : 'disabled'}>🕐 出勤打刻</button>
      </div>`;
  }

  // ─── 出勤中 ─────────────────────────────────
  if (state === STATES.WORKING) {
    const elapsed = appState.workStart ? minutesBetween(appState.workStart, now()) : 0;
    const actualMin = elapsed - (st?.breakMin || 0);
    const warn = overtimeWarn();
    const h = Math.floor(elapsed/60), m = elapsed%60;
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-briefcase"></i> 出勤中</h2>
        ${staffChip(st)}
        <div class="time-display">${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}<span class="time-unit"> 経過</span></div>
        <div class="info-row"><span class="info-label">出勤時刻</span><span>${st?.clockIn || hhmm(appState.workStart) || '—'}</span></div>
        <div class="info-row"><span class="info-label">休憩累計</span><span>${st?.breakMin || 0}分</span></div>
        <div class="info-row"><span class="info-label">実働</span><span>${fmtMinutes(Math.max(0, actualMin))}</span></div>
        ${st?.hourlyRate ? `<div class="info-row"><span class="info-label">時給</span><span>¥${st.hourlyRate}</span></div>` : ''}
        ${warn ? `<div class="warn-box"><i class="ti ti-alert-triangle"></i> ${warn}</div>` : ''}
        <div class="btn-row">
          <button class="btn-secondary" id="btn-break-start">休憩開始</button>
          <button class="btn-primary"   id="btn-clock-out">退勤打刻</button>
        </div>
        <button class="btn-ghost" id="btn-overtime-apply">残業申請する</button>
      </div>`;
  }

  // ─── 休憩中 ─────────────────────────────────
  if (state === STATES.ON_BREAK) {
    const breakElapsed = appState.breakStart ? minutesBetween(appState.breakStart, now()) : 0;
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-coffee"></i> 休憩中</h2>
        ${staffChip(st)}
        <div class="time-display">${breakElapsed}<span class="time-unit"> 分経過</span></div>
        <div class="info-row"><span class="info-label">休憩開始</span><span>${hhmm(appState.breakStart) || '—'}</span></div>
        <div class="info-row"><span class="info-label">休憩累計（本日）</span><span>${(st?.breakMin || 0) + breakElapsed}分</span></div>
        <button class="btn-primary btn-xl" id="btn-break-end">休憩終了</button>
      </div>`;
  }

  // ─── 残業申請中 ─────────────────────────────
  if (state === STATES.OVERTIME_APPLYING) {
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-clock-plus"></i> 残業申請</h2>
        ${staffChip(st)}
        <div class="info-row"><span class="info-label">出勤時刻</span><span>${st?.clockIn || '—'}</span></div>
        <div class="info-row"><span class="info-label">残業申請状態</span><span class="badge-warn">申請中</span></div>
        <div class="form-group">
          <label>残業時間（分）</label>
          <input type="number" id="inp-overtime-min" value="${st?.overtimeMin || 60}" min="15" max="240" step="15" />
        </div>
        <div class="form-group">
          <label>残業理由</label>
          <textarea id="inp-overtime-reason" rows="3" placeholder="残業が必要な理由を入力">${st?.note?.startsWith('残業') ? '' : ''}</textarea>
        </div>
        <button class="btn-primary" id="btn-overtime-send">残業申請を送信</button>
        <p class="hint">残業は事前申請制（業務ルール）</p>
      </div>`;
  }

  // ─── 欠勤申請中 ─────────────────────────────
  if (state === STATES.ABSENCE_APPLYING) {
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-calendar-x"></i> 欠勤申請</h2>
        ${staffChip(st)}
        <div class="info-row"><span class="info-label">対象シフト</span><span>8/1(月) 10:00〜18:00</span></div>
        <div class="info-row"><span class="info-label">承認状態</span><span class="badge-warn">申請中</span></div>
        <div class="form-group">
          <label>欠勤理由</label>
          <textarea id="inp-absence-reason" rows="3" placeholder="理由を入力してください">${st?.note || ''}</textarea>
        </div>
        <button class="btn-primary" id="btn-absence-send">欠勤申請を送信</button>
      </div>`;
  }

  // ─── 代替募集中 ─────────────────────────────
  if (state === STATES.REPLACEMENT_OPEN) {
    const DOW = ['日','月','火','水','木','金','土'];

    // ─── 自分が募集されている側（欠勤承認済みで代替を探している当人）───
    if (st?.state === STATES.REPLACEMENT_OPEN || appState.currentStaff?.id === st?.id) {
      // 自分のshiftRequestsから欠勤対象シフトを特定
      const myReqs = DEMO.shiftRequests.filter(r => r.staffId === st?.id);
      const shiftInfo = myReqs.length > 0
        ? (() => {
            const r = myReqs[0];
            const d = new Date(r.date);
            return `${r.date.slice(5).replace('-','/')}(${DOW[d.getDay()]}) ${r.start}〜${r.end}`;
          })()
        : '未定';

      // 同じ店舗で代替応募してきたスタッフ（shiftRequestsで判断）
      const applicants = DEMO.staff.filter(s =>
        s.store === st?.store &&
        s.role === ROLES.PART_TIME &&
        s.id !== st?.id &&
        s.state !== STATES.ABSENCE_APPLYING &&
        s.state !== STATES.REPLACEMENT_OPEN
      ).slice(0, 3); // デモ用に先頭3名を候補として表示

      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-repeat"></i> 代替募集中（自分のシフト）</h2>
          ${staffChip(st)}
          <div class="warn-box"><i class="ti ti-info-circle"></i> あなたの欠勤が承認され、代替スタッフを募集しています</div>
          <div class="info-row"><span class="info-label">募集シフト</span><span>${shiftInfo}</span></div>
          <div class="info-row"><span class="info-label">店舗</span><span>${st?.store}</span></div>
          <div class="info-row"><span class="info-label">締切</span><span class="warn-text">7/31 23:59</span></div>
          <div class="info-row"><span class="info-label">応募状況</span><span class="badge-warn">募集中</span></div>
          <p class="hint">店長が代替スタッフを決定次第、通知されます。</p>
        </div>`;
    }

    // ─── 応募する側（他のアルバイト）───────────────────────────────
    // 自分の店舗で REPLACEMENT_OPEN のスタッフを探す
    const openSlots = DEMO.staff.filter(s =>
      s.store === st?.store &&
      s.state === STATES.REPLACEMENT_OPEN &&
      s.id !== st?.id
    );

    const slotRows = openSlots.map(absent => {
      const reqs = DEMO.shiftRequests.filter(r => r.staffId === absent.id);
      return reqs.map(r => {
        const d = new Date(r.date);
        const label = `${r.date.slice(5).replace('-','/')}(${DOW[d.getDay()]})`;
        return `
          <div class="approval-row">
            <div class="approval-info">
              <span class="approval-name">${label} ${r.start}〜${r.end}</span>
              <span class="approval-detail">${absent.store} ／ 時給 ¥${absent.hourlyRate || '—'}</span>
              <span class="approval-note">欠員：${absent.name}さんの代替</span>
            </div>
            <div class="approval-btns">
              <button class="btn-primary btn-apply-slot"
                onclick="applyReplacement(${absent.id}, '${r.date}')">応募する</button>
            </div>
          </div>`;
      }).join('');
    }).join('');

    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-repeat"></i> 代替シフト応募</h2>
        ${staffChip(st)}
        <div class="info-row">
          <span class="info-label">対象店舗</span><span>${st?.store}</span>
        </div>
        <div class="info-row">
          <span class="info-label">募集中件数</span>
          <span class="${openSlots.length > 0 ? 'badge-warn' : 'badge-ok'}">${openSlots.length}件</span>
        </div>
        ${openSlots.length > 0
          ? `<div class="approval-list" style="margin-top:8px">${slotRows}</div>`
          : '<div class="badge-success-lg">現在、代替募集中のシフトはありません</div>'
        }
        <p class="hint">応募後、店長が確定します。重複応募はできません。</p>
      </div>`;
  }

  // ─── 勤怠未確定 ─────────────────────────────
  if (state === STATES.ATTENDANCE_PENDING) {
    const role = appState.currentRole;

    // ─── 店長・管理者：部下の勤怠一覧を確認・確定 ───────────────
    if (role === ROLES.MANAGER || role === ROLES.ADMIN) {
      const myStore = st?.store;

      // 対象スタッフ（店長→自店舗アルバイト / 管理者→管理者以外全員）
      const targets = DEMO.staff.filter(s => {
        if (role === ROLES.MANAGER) return s.role === ROLES.PART_TIME && s.store === myStore;
        return s.role !== ROLES.ADMIN;
      });

      const pending  = targets.filter(s => s.state === STATES.ATTENDANCE_PENDING);
      const done     = targets.filter(s => s.state === STATES.SALARY_PENDING);

      const pendingRows = pending.map(s => {
        const wm = calcWorkMin(s);
        const est = s.hourlyRate && wm > 0 ? `¥${Math.round(s.hourlyRate * wm / 60).toLocaleString()}` : '—';
        return `
          <div class="approval-row">
            <div class="approval-info">
              <span class="approval-name">${s.name} <span class="sl-role">${s.store}</span></span>
              <span class="approval-detail">
                出勤 ${s.clockIn || '—'} → 退勤 ${s.clockOut || '—'}
                ／ 休憩 ${s.breakMin || 0}分 ／ 実働 ${wm > 0 ? fmtMinutes(wm) : '—'}
              </span>
              <span class="approval-detail">概算 ${est}${s.overtimeMin > 0 ? ' ／ 残業 ' + s.overtimeMin + '分' : ''}</span>
            </div>
            <div class="approval-btns">
              <button class="btn-primary" onclick="confirmAttendance(${s.id})">確定</button>
            </div>
          </div>`;
      });

      const doneRows = done.map(s => {
        const wm = calcWorkMin(s);
        return `
          <div class="approval-row" style="opacity:0.6">
            <div class="approval-info">
              <span class="approval-name">${s.name} <span class="badge-ok" style="font-size:11px;padding:1px 7px">確定済</span></span>
              <span class="approval-detail">実働 ${wm > 0 ? fmtMinutes(wm) : '—'}</span>
            </div>
          </div>`;
      });

      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-clipboard-check"></i> 勤怠確認・確定</h2>
          ${staffChip(st)}
          <div class="info-grid">
            <div class="info-card warn">
              <div class="info-num">${pending.length}</div>
              <div>未確定</div>
            </div>
            <div class="info-card">
              <div class="info-num">${done.length}</div>
              <div>確定済</div>
            </div>
          </div>
          ${pending.length > 0 ? `
            <div class="approval-list">${pendingRows.join('')}</div>
            <button class="btn-primary" id="btn-attendance-confirm" style="margin-top:8px">全員まとめて確定</button>
          ` : `<div class="badge-success-lg">✓ 未確定の勤怠はありません</div>`}
          ${done.length > 0 ? `
            <div style="margin-top:12px;font-size:12px;color:var(--color-text-3);font-weight:600;letter-spacing:0.04em;text-transform:uppercase">確定済み</div>
            <div class="approval-list">${doneRows.join('')}</div>
          ` : ''}
          <p class="hint">Undefined: 打刻改ざん対策</p>
        </div>`;
    }

    // ─── アルバイト：自分の勤怠を確認 ───────────────────────────
    const workMin = calcWorkMin(st);
    const salEst  = st?.hourlyRate && workMin > 0 ? Math.round(st.hourlyRate * workMin / 60) : null;
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-clipboard-check"></i> 勤怠確認</h2>
        ${staffChip(st)}
        <div class="info-row"><span class="info-label">出勤</span><span>${st?.clockIn || '—'}</span></div>
        <div class="info-row"><span class="info-label">退勤</span><span>${st?.clockOut || '—'}</span></div>
        <div class="info-row"><span class="info-label">休憩</span><span>${st?.breakMin || 0}分</span></div>
        <div class="info-row"><span class="info-label">残業</span><span>${st?.overtimeMin || 0}分</span></div>
        <div class="info-row"><span class="info-label">実働</span><span>${workMin > 0 ? fmtMinutes(workMin) : '—'}</span></div>
        ${salEst ? `<div class="info-row"><span class="info-label">概算給与</span><span class="staff-name-chip">¥${salEst.toLocaleString()}</span></div>` : ''}
        <p class="hint">内容に誤りがある場合は店長に連絡してください。Undefined: 打刻改ざん対策</p>
      </div>`;
  }

  // ─── 給与未計算 ─────────────────────────────
  if (state === STATES.SALARY_PENDING) {
    const workMin = calcWorkMin(st);
    const salary  = st?.hourlyRate && workMin > 0
      ? Math.round(st.hourlyRate * workMin / 60 * (st.overtimeMin > 0 ? RULES.LATE_NIGHT_BONUS : 1))
      : null;
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-coin"></i> 給与計算</h2>
        ${staffChip(st)}
        <div class="info-row"><span class="info-label">対象月</span><span>${getShiftTargetMonthJP()}</span></div>
        ${st?.hourlyRate ? `<div class="info-row"><span class="info-label">時給</span><span>¥${st.hourlyRate}</span></div>` : ''}
        ${workMin > 0 ? `<div class="info-row"><span class="info-label">実働</span><span>${fmtMinutes(workMin)}</span></div>` : ''}
        ${salary ? `<div class="info-row"><span class="info-label">概算支給額</span><span class="staff-name-chip">¥${salary.toLocaleString()}</span></div>` : ''}
        <div class="info-row"><span class="info-label">深夜割増</span><span>×${RULES.LATE_NIGHT_BONUS}</span></div>
        <button class="btn-primary" id="btn-salary-calc">給与計算を実行</button>
        <p class="hint">CSV出力は管理者のみ | Undefined: CSV項目定義</p>
      </div>`;
  }

  // ─── 通知送信失敗 ───────────────────────────
  if (state === STATES.NOTIFY_FAILED) {
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-bell-x"></i> 通知送信失敗</h2>
        ${staffChip(st)}
        <div class="warn-box">通知送信に失敗しています。再送してください。</div>
        <div class="info-row"><span class="info-label">失敗件数</span><span class="badge-error">3件</span></div>
        <div class="info-row"><span class="info-label">最終エラー</span><span>SMTP接続タイムアウト</span></div>
        <button class="btn-primary" id="btn-notify-retry">通知を手動再送</button>
        <p class="hint">Undefined: 通知テンプレ編集</p>
      </div>`;
  }

  return `<div class="view-card"><p class="hint">Undefined: 状態「${state}」のUIは未定義です</p></div>`;
}

function staffChip(st) {
  if (!st) return '';
  const minor = st.isMinor ? ' <span class="sl-minor">未成年</span>' : '';
  return `<div class="info-row"><span class="info-label">スタッフ</span><span class="staff-name-chip">${st.name}${minor}（${st.store}）</span></div>`;
}

/* ═══════════════════════════════════════
   イベントバインド
═══════════════════════════════════════ */
function bindViewEvents() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };

  // ログイン
  on('btn-login', 'click', () => {
    const staffId  = document.getElementById('inp-staff-id')?.value;
    const password = document.getElementById('inp-password')?.value;
    const ok = patchedTransition('LOGIN', { staffId, password });
    if (!ok) {
      const e = document.getElementById('login-error');
      if (e) { e.style.display = 'block'; e.textContent = 'ログインに失敗しました。スタッフを選択しパスワードを入力してください。'; }
    }
  });

  // 勤務希望
  on('btn-shift-add',    'click', () => addShiftRequest());
  on('btn-shift-submit', 'click', () => transition('SHIFT_REQUEST_SUBMIT'));
  on('btn-shift-draft',  'click', () => { transition('SHIFT_SAVE'); showToast('一時保存しました'); });
  on('btn-shift-confirm','click', () => transition('SHIFT_CONFIRM'));
  on('btn-shift-publish','click', () => {
    const store = appState.currentStaff?.store;
    const count = (DEMO.confirmedShifts || []).filter(c => {
      const s = DEMO.staff.find(s => s.id === c.staffId);
      return s?.store === store;
    }).length;
    if (count === 0) {
      showError('シフト作成画面で「割当確定」を1件以上押してから公開してください');
      return;
    }
    transition('SHIFT_PUBLISH');
  });

  // 欠勤
  on('btn-absence-apply','click', () => transition('ABSENCE_APPLY'));
  on('btn-absence-send', 'click', () => {
    const reason = document.getElementById('inp-absence-reason')?.value || '';
    updateStaff({ note: `欠勤申請: ${reason || '理由未記入'}` });
    showToast('欠勤申請を送信しました');
  });

  // Wi-Fi
  on('chk-wifi', 'change', (e) => { appState.wifiConnected = e.target.checked; updateGuideOnStateChange(); });

  // 打刻
  on('btn-clock-in',    'click', () => transition('CLOCK_IN'));
  on('btn-break-start', 'click', () => transition('BREAK_START'));
  on('btn-break-end',   'click', () => transition('BREAK_END'));
  on('btn-clock-out',   'click', () => transition('CLOCK_OUT'));

  // 残業
  on('btn-overtime-apply', 'click', () => {
    appState.currentState = STATES.OVERTIME_APPLYING;
    updateStaff({ state: STATES.OVERTIME_APPLYING });
    updateGuideOnStateChange();
  });
  on('btn-overtime-send', 'click', () => transition('OVERTIME_APPLY'));

  // 勤怠
  on('btn-attendance-fix',    'click', () => { transition('ATTENDANCE_FIX'); showToast('Undefined: 打刻修正UI'); });
  on('btn-attendance-confirm','click', () => {
    const role = appState.currentRole;
    if (role === ROLES.MANAGER || role === ROLES.ADMIN) {
      // 全員まとめて確定
      const myStore = appState.currentStaff?.store;
      const targets = DEMO.staff.filter(s => {
        if (role === ROLES.MANAGER) return s.role === ROLES.PART_TIME && s.store === myStore && s.state === STATES.ATTENDANCE_PENDING;
        return s.role !== ROLES.ADMIN && s.state === STATES.ATTENDANCE_PENDING;
      });
      targets.forEach(s => confirmAttendance(s.id));
      showToast(`${targets.length}名の勤怠を確定しました`);
    } else {
      transition('ATTENDANCE_CONFIRM');
    }
  });

  // 給与
  on('btn-salary-calc',       'click', () => { transition('SALARY_CALC'); showToast('給与計算を実行しました'); });

  // 通知
  on('btn-notify-retry',      'click', () => { transition('NOTIFY_RETRY'); showToast('通知を再送しました'); });

  // 代替
  on('btn-replacement-apply', 'click', () => { transition('REPLACEMENT_APPLY'); showToast('代替応募しました'); });
}

/* ═══════════════════════════════════════
   スタッフ一覧
═══════════════════════════════════════ */
const STATE_COLOR = {
  [STATES.LOGGED_OUT]:          { cls: 'sl-gray',   label: '未ログイン' },
  [STATES.SHIFT_REQ_PENDING]:   { cls: 'sl-warn',   label: '希望未提出' },
  [STATES.SHIFT_REQ_SUBMITTED]: { cls: 'sl-info',   label: '希望提出済' },
  [STATES.SHIFT_CREATING]:      { cls: 'sl-purple', label: 'シフト作成中' },
  [STATES.SHIFT_CONFIRMED]:     { cls: 'sl-purple', label: 'シフト確定済' },
  [STATES.SHIFT_PUBLISHED]:     { cls: 'sl-info',   label: 'シフト公開済' },
  [STATES.PRE_WORK]:            { cls: 'sl-amber',  label: '出勤前' },
  [STATES.WORKING]:             { cls: 'sl-ok',     label: '出勤中' },
  [STATES.ON_BREAK]:            { cls: 'sl-teal',   label: '休憩中' },
  [STATES.OVERTIME_APPLYING]:   { cls: 'sl-warn',   label: '残業申請中' },
  [STATES.ABSENCE_APPLYING]:    { cls: 'sl-error',  label: '欠勤申請中' },
  [STATES.REPLACEMENT_OPEN]:    { cls: 'sl-error',  label: '代替募集中' },
  [STATES.ATTENDANCE_PENDING]:  { cls: 'sl-amber',  label: '勤怠未確定' },
  [STATES.SALARY_PENDING]:      { cls: 'sl-info',   label: '給与未計算' },
  [STATES.NOTIFY_FAILED]:       { cls: 'sl-error',  label: '通知失敗' },
};

let staffFilter = { state: 'all', role: 'all', store: 'all', search: '' };

function renderStaffList() {
  const container = document.getElementById('staff-list-panel');
  if (!container) return;

  const me   = appState.currentStaff;
  const role = appState.currentRole;

  /* ── 権限別ベースフィルタ ──────────────────────────────
     店長   → 自分の店舗のアルバイトのみ
     管理者 → 管理者以外の全員（他の管理者・自分自身は除く）
     それ以外 → 表示なし（renderStaffListIfAllowedで制御済みだが念のため）
  ───────────────────────────────────────────────────── */
  const base = DEMO.staff.filter(s => {
    if (role === ROLES.MANAGER) {
      return s.role === ROLES.PART_TIME && s.store === me?.store;
    }
    if (role === ROLES.ADMIN) {
      return s.role !== ROLES.ADMIN; // 管理者は全員除外（自分含む）
    }
    return false;
  });

  // フィルタUIの選択肢は base の範囲内だけ
  const stores    = [...new Set(base.map(s => s.store))].sort();
  const stateKeys = [...new Set(base.map(s => s.state))].sort();

  // 絞り込み（staffFilterはbaseの上に重ねる）
  const list = base.filter(s => {
    if (staffFilter.state  !== 'all' && s.state  !== staffFilter.state)  return false;
    if (staffFilter.role   !== 'all' && s.role   !== staffFilter.role)   return false;
    if (staffFilter.store  !== 'all' && s.store  !== staffFilter.store)  return false;
    if (staffFilter.search) {
      const q = staffFilter.search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !s.note.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // 統計も base の範囲内で集計
  const counts = {};
  base.forEach(s => { counts[s.state] = (counts[s.state] || 0) + 1; });
  const working  = (counts[STATES.WORKING] || 0) + (counts[STATES.ON_BREAK] || 0);
  const alertCnt = (counts[STATES.ABSENCE_APPLYING] || 0) + (counts[STATES.NOTIFY_FAILED] || 0)
                 + (counts[STATES.OVERTIME_APPLYING] || 0) + (counts[STATES.REPLACEMENT_OPEN] || 0);

  container.innerHTML = `
    <div class="sl-header">
      <div class="sl-title">
        <i class="ti ti-users"></i>
        ${role === ROLES.MANAGER
          ? `スタッフ一覧 <span class="scope-label"><i class="ti ti-building-store"></i>${me?.store}のアルバイト</span>`
          : `スタッフ一覧 <span class="scope-label"><i class="ti ti-world"></i>全店舗（管理者除く）</span>`}
        <span class="sl-count">${base.length}名</span>
      </div>
      <div class="sl-stats">
        <span class="sl-stat sl-ok">出勤中 ${working}名</span>
        <span class="sl-stat sl-error">要対応 ${alertCnt}名</span>
        <span class="sl-stat sl-warn">勤怠未確定 ${counts[STATES.ATTENDANCE_PENDING] || 0}名</span>
      </div>
    </div>
    <div class="sl-filters">
      <input class="sl-search" type="text" placeholder="名前・メモ検索…" value="${staffFilter.search}"
        oninput="staffFilter.search=this.value; renderStaffList()" />
      <select onchange="staffFilter.state=this.value; renderStaffList()">
        <option value="all">全状態</option>
        ${stateKeys.map(s => `<option value="${s}" ${staffFilter.state===s?'selected':''}>${STATE_COLOR[s]?.label||s}</option>`).join('')}
      </select>
      ${role === ROLES.MANAGER ? '' : `
      <select onchange="staffFilter.role=this.value; renderStaffList()">
        <option value="all">全ロール</option>
        <option value="${ROLES.MANAGER}"   ${staffFilter.role===ROLES.MANAGER  ?'selected':''}>店長</option>
        <option value="${ROLES.PART_TIME}" ${staffFilter.role===ROLES.PART_TIME?'selected':''}>アルバイト</option>
      </select>`}
      <select onchange="staffFilter.store=this.value; renderStaffList()">
        <option value="all">全店舗</option>
        ${stores.map(s => `<option value="${s}" ${staffFilter.store===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="sl-result-count">
      ${list.length}件表示（全${base.length}名中）—
      <span style="color:var(--color-primary)">行クリックでそのスタッフとしてログイン</span>
    </div>
    <div class="sl-table">
      <div class="sl-row sl-row-header">
        <span>名前</span><span>ロール</span><span>店舗</span><span>状態</span><span>時給</span><span>打刻</span><span>メモ</span>
      </div>
      ${list.map(s => {
        const sc     = STATE_COLOR[s.state] || { cls: 'sl-gray', label: s.state };
        const clock  = s.clockIn ? `${s.clockIn}${s.clockOut ? ' → ' + s.clockOut : ' →（中）'}` : '—';
        const rate   = s.hourlyRate ? `¥${s.hourlyRate}` : '—';
        const minor  = s.isMinor ? ' <span class="sl-minor">未成年</span>' : '';
        const ot     = s.overtimeMin > 0 ? `<span class="sl-ot">残業${s.overtimeMin}分</span>` : '';
        const active = appState.currentStaff?.id === s.id;
        return `
          <div class="sl-row sl-row-body ${active ? 'sl-row-active' : ''}"
            onclick="${appState.currentRole === ROLES.ADMIN ? 'loginAsStaff' : 'showStaffDetail'}(${s.id})"
            title="${appState.currentRole === ROLES.ADMIN ? s.name + 'としてログイン' : s.name + 'の詳細を表示'}">
            <span class="sl-name">${s.name}${minor}</span>
            <span class="sl-role">${ROLE_LABEL[s.role]}</span>
            <span class="sl-store">${s.store}</span>
            <span><span class="sl-badge ${sc.cls}">${sc.label}</span>${ot}</span>
            <span class="sl-rate">${rate}</span>
            <span class="sl-clock">${clock}</span>
            <span class="sl-note">${s.note}</span>
          </div>`;
      }).join('')}
    </div>`;
}

/* ─── 一覧行クリック → そのスタッフとしてログイン ─── */
/* ─── スタッフ詳細表示（店長用：クリックしてもログインせず詳細だけ表示） ─── */
function showStaffDetail(staffId) {
  const s = DEMO.staff.find(st => st.id === staffId);
  if (!s) return;
  const mainView = document.getElementById('main-view');
  if (!mainView) return;

  const DOW = ['日','月','火','水','木','金','土'];

  // 確定シフト
  const myShifts = (DEMO.confirmedShifts || [])
    .filter(c => c.staffId === s.id)
    .sort((a, b) => a.date.localeCompare(b.date));

  const shiftRows = myShifts.map(c => {
    const d = new Date(c.date);
    const label = `${c.date.slice(5).replace('-','/')}(${DOW[d.getDay()]})`;
    return `<div class="shift-row">
      <span>${label}</span>
      <span>${c.start}〜${c.end}</span>
      <span class="badge-ok">確定済</span>
    </div>`;
  }).join('');

  // 状態バッジ
  const STATE_COLOR = {
    '未ログイン':       'sl-gray',
    '勤務希望未提出':   'sl-warn',
    '勤務希望提出済':   'sl-info',
    'シフト作成中':     'sl-purple',
    'シフト確定済':     'sl-purple',
    'シフト公開済':     'sl-info',
    '出勤前':           'sl-amber',
    '出勤中':           'sl-ok',
    '休憩中':           'sl-teal',
    '残業申請中':       'sl-warn',
    '欠勤申請中':       'sl-error',
    '代替募集中':       'sl-error',
    '勤怠未確定':       'sl-amber',
    '給与未計算':       'sl-info',
    '通知送信失敗':     'sl-error',
  };
  const stateClass = STATE_COLOR[s.state] || 'sl-gray';

  // 打刻状況
  const clockInfo = s.clockIn
    ? `出勤 ${s.clockIn}${s.clockOut ? ' → 退勤 ' + s.clockOut : ' →（勤務中）'}`
    : '未打刻';

  mainView.innerHTML = `
    <div class="view-card">
      <h2 class="view-title"><i class="ti ti-user"></i> スタッフ詳細</h2>

      <div class="staff-detail-header">
        <div class="staff-detail-avatar">${s.name.slice(0,1)}</div>
        <div class="staff-detail-info">
          <div class="staff-detail-name">${s.name} ${s.isMinor ? '<span class="sl-minor">未成年</span>' : ''}</div>
          <div class="staff-detail-sub">${s.store} ／ アルバイト ／ ¥${s.hourlyRate || '—'}/時</div>
        </div>
        <span class="sl-badge ${stateClass}" style="align-self:center">${s.state}</span>
      </div>

      <div class="info-row"><span class="info-label">打刻</span><span>${clockInfo}</span></div>
      ${s.breakMin > 0 ? `<div class="info-row"><span class="info-label">休憩累計</span><span>${s.breakMin}分</span></div>` : ''}
      ${s.overtimeMin > 0 ? `<div class="info-row"><span class="info-label">残業</span><span class="warn-text">${s.overtimeMin}分</span></div>` : ''}
      <div class="info-row"><span class="info-label">メモ</span><span class="sl-note">${s.note || '—'}</span></div>

      <div style="margin-top:12px">
        <div style="font-size:12px;font-weight:600;color:var(--color-text-3);letter-spacing:0.05em;text-transform:uppercase;margin-bottom:8px">
          確定シフト
        </div>
        ${myShifts.length > 0
          ? `<div class="shift-table">
              <div class="shift-row header"><span>日付</span><span>時間</span><span>状態</span></div>
              ${shiftRows}
            </div>`
          : '<div class="warn-box"><i class="ti ti-info-circle"></i> 確定シフトなし</div>'
        }
      </div>

      <button class="btn-ghost" onclick="renderMainView()" style="margin-top:4px">
        <i class="ti ti-arrow-left"></i> 戻る
      </button>
    </div>`;

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function loginAsStaff(staffId) {
  const staff = DEMO.staff.find(s => s.id === staffId);
  if (!staff) return;

  appState.currentStaff  = staff;
  appState.currentRole   = staff.role;
  appState.sessionExpiry = new Date(Date.now() + RULES.SESSION_HOURS * 3600 * 1000);
  appState.workStart     = null;
  appState.breakStart    = null;

  if (staff.clockIn && !staff.clockOut) {
    appState.workStart = parseHHMM(staff.clockIn);
  }
  if (staff.state === STATES.ON_BREAK) {
    appState.breakStart = new Date(Date.now() - (staff.breakMin || 10) * 60000);
  }

  // ロール別デフォルト初期状態（スタッフ自身のstateがLOGGED_OUTの場合）
  const defaultStateByRole = {
    [ROLES.ADMIN]:     STATES.ATTENDANCE_PENDING,
    [ROLES.MANAGER]:   STATES.SHIFT_CREATING,
    [ROLES.PART_TIME]: STATES.SHIFT_REQ_PENDING,
  };
  let targetState = staff.state !== STATES.LOGGED_OUT
    ? staff.state
    : (defaultStateByRole[staff.role] || STATES.SHIFT_REQ_PENDING);

  // 店長・管理者のシフトフェーズから状態を復元
  if (staff.role === ROLES.MANAGER) {
    const phase = getShiftPhase(staff.store);
    if (phase === 'confirmed') targetState = STATES.SHIFT_CONFIRMED;
    else if (phase === 'published') targetState = STATES.SHIFT_PUBLISHED;
    else targetState = STATES.SHIFT_CREATING;
  }

  ensureClockConsistencyForStaff(staff, targetState);
  appState.currentState = targetState;
  logT('STAFF_LOGIN', `${staff.name}（${ROLE_LABEL[staff.role]}・${staff.store}）でログイン`);
  updateGuideOnStateChange();
  if (!window.ShiftAPI?.testMode) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─── 勤務実態集計 ─── */
function calcWorkSummary(staff) {
  if (!staff) return { current: { shifts:0, minutes:0, salary:0 }, history: { months:[], totalShifts:0, totalMinutes:0, totalSalary:0 } };

  const now   = new Date();
  const thisY = now.getFullYear();
  const thisM = now.getMonth() + 1; // 1-12

  // confirmedShifts から自分の分を取得
  const myShifts = (DEMO.confirmedShifts || []).filter(c => c.staffId === staff.id);

  // 月ごとに集計
  function collectMonth(year, month) {
    const mm = String(month).padStart(2, '0');
    const prefix = `${year}-${mm}`;
    const shifts = myShifts.filter(c => c.date.startsWith(prefix));

    // 実働時間計算（clockIn/clockOut があれば使う、なければシフト時間で推定）
    let totalMin = 0;
    shifts.forEach(c => {
      const s2 = DEMO.staff.find(s => s.id === staff.id);
      // 当該シフトの打刻データがあれば使う（簡易：staff.clockIn/clockOutは最新のみ保持）
      // → デモでは確定シフトの時間差で推定
      const [sh, sm] = c.start.split(':').map(Number);
      const [eh, em] = c.end.split(':').map(Number);
      totalMin += (eh * 60 + em) - (sh * 60 + sm) - 60; // 60分休憩を仮定
    });

    const salary = staff.hourlyRate
      ? Math.round(staff.hourlyRate * totalMin / 60)
      : null;

    return { year, month, label: `${year}年${month}月`, shifts: shifts.length, minutes: Math.max(0, totalMin), salary };
  }

  // 当月
  const current = collectMonth(thisY, thisM);

  // 過去3ヶ月
  const historyMonths = [];
  for (let i = 1; i <= 3; i++) {
    let m = thisM - i;
    let y = thisY;
    if (m <= 0) { m += 12; y -= 1; }
    historyMonths.push(collectMonth(y, m));
  }

  const totalShifts  = historyMonths.reduce((s, m) => s + m.shifts,  0);
  const totalMinutes = historyMonths.reduce((s, m) => s + m.minutes, 0);
  const totalSalary  = staff.hourlyRate
    ? Math.round(staff.hourlyRate * totalMinutes / 60)
    : null;

  return {
    current,
    history: { months: historyMonths, totalShifts, totalMinutes, totalSalary }
  };
}

/* ─── 勤務実態パネル表示 ─── */
function showWorkSummary(type) {
  const me = appState.currentStaff;
  if (!me) return;
  const mainView = document.getElementById('main-view');
  if (!mainView) return;

  const summary = calcWorkSummary(me);

  // タブ強調
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('next-target'));
  const tabId = type === 'current' ? 'tab-work-current' : 'tab-work-history';
  document.getElementById(tabId)?.classList.add('next-target');

  if (type === 'current') {
    const c = summary.current;
    const workHours = Math.floor(c.minutes / 60);
    const workMins  = c.minutes % 60;

    mainView.innerHTML = `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-chart-bar"></i> 勤務実態（当月）</h2>
        <div class="info-row"><span class="info-label">スタッフ</span><span class="staff-name-chip">${me.name}（${me.store}）</span></div>
        <div class="info-row"><span class="info-label">対象月</span><span>${c.label}</span></div>
        <div class="info-grid" style="margin-top:8px">
          <div class="info-card">
            <div class="info-num">${c.shifts}</div>
            <div>確定シフト数</div>
          </div>
          <div class="info-card">
            <div class="info-num">${workHours}<span style="font-size:16px;font-weight:400">h${workMins > 0 ? workMins + 'm' : ''}</span></div>
            <div>推定実働時間</div>
          </div>
        </div>
        ${c.salary !== null
          ? '<div class="info-card" style="margin-top:8px;text-align:center"><div class="info-num">¥' + c.salary.toLocaleString() + '</div><div>推定給与（時給¥' + me.hourlyRate + ' × ' + fmtMinutes(c.minutes) + '）</div></div>'
          : ''}
        ${c.shifts === 0 ? '<div class="warn-box" style="margin-top:8px"><i class="ti ti-info-circle"></i> 当月の確定シフトはまだありません</div>' : ''}
        <p class="hint" style="margin-top:8px">※ 休憩60分を差し引いた推定値です。実際の打刻データが確定した後に正式な数値が確定します。</p>
      </div>`;

  } else {
    const h = summary.history;
    const totalH = Math.floor(h.totalMinutes / 60);
    const totalM = h.totalMinutes % 60;

    const monthRows = h.months.map(m => {
      const hh = Math.floor(m.minutes / 60);
      const mm = m.minutes % 60;
      return `
        <div class="work-history-row">
          <span class="work-month">${m.label}</span>
          <span class="work-shifts">${m.shifts}件</span>
          <span class="work-time">${hh}h${mm > 0 ? mm + 'm' : ''}</span>
          <span class="work-salary">${m.salary !== null ? '¥' + m.salary.toLocaleString() : '—'}</span>
        </div>`;
    }).join('');

    mainView.innerHTML = `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-history"></i> 勤務実態（過去3ヶ月）</h2>
        <div class="info-row"><span class="info-label">スタッフ</span><span class="staff-name-chip">${me.name}（${me.store}）</span></div>
        <div class="work-history-table">
          <div class="work-history-row work-history-header">
            <span>月</span><span>件数</span><span>実働</span><span>推定給与</span>
          </div>
          ${monthRows || '<div class="work-history-row"><span style="color:var(--color-text-3)">データなし</span></div>'}
        </div>
        <div class="info-grid" style="margin-top:12px">
          <div class="info-card">
            <div class="info-num">${h.totalShifts}</div>
            <div>合計シフト数</div>
          </div>
          <div class="info-card">
            <div class="info-num">${totalH}<span style="font-size:16px;font-weight:400">h${totalM > 0 ? totalM + 'm' : ''}</span></div>
            <div>合計実働時間</div>
          </div>
        </div>
        ${h.totalSalary !== null && h.totalShifts > 0
          ? '<div class="info-card" style="margin-top:8px;text-align:center"><div class="info-num">¥' + h.totalSalary.toLocaleString() + '</div><div>3ヶ月合計推定給与</div></div>'
          : ''}
        <p class="hint" style="margin-top:8px">※ 休憩60分を差し引いた推定値です。</p>
      </div>`;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─── デモジャンプ（サイドバーボタン用） ─── */
function jumpToState(state) {
  appState.currentState = state;

  if (state !== STATES.LOGGED_OUT && !appState.currentRole) {
    appState.currentRole = ROLES.PART_TIME;
    appState.sessionExpiry = new Date(Date.now() + 8 * 3600000);
  }

  if (state === STATES.WORKING && !appState.workStart) {
    appState.workStart = new Date(Date.now() - 3600000);
  }

  if (appState.currentStaff) {
    appState.currentStaff.state = state;
    ensureClockConsistencyForStaff(appState.currentStaff, state);
  }

  logT('DEMO_JUMP', `デモジャンプ → ${state}`);
  updateGuideOnStateChange();
}

/* ═══════════════════════════════════════
   ユーティリティ
═══════════════════════════════════════ */
function logT(event, message) {
  appState.transitionLog.unshift({ timestamp: new Date().toLocaleTimeString('ja-JP'), event, message, state: appState.currentState });
  if (appState.transitionLog.length > 60) appState.transitionLog.pop();
  renderTransitionLog();
}

function renderTransitionLog() {
  const el = document.getElementById('transition-log');
  if (!el) return;
  el.innerHTML = appState.transitionLog.slice(0, 20).map(e => `
    <div class="log-entry">
      <span class="log-time">${e.timestamp}</span>
      <span class="log-event">${e.event}</span>
      <span class="log-msg">${e.message}</span>
    </div>`).join('');
}

function showError(msg) {
  const el = document.getElementById('global-error');
  if (!el) return;
  el.textContent = msg; el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 5000);
}

function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast show';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, 2500);
}

/* ═══════════════════════════════════════
   初期化
═══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  updateGuideOnStateChange();
});

/* ═══════════════════════════════════════
   サイドバー描画（ロール別）
═══════════════════════════════════════ */
function renderSidebar() {
  const el = document.getElementById('app-sidebar');
  if (!el) return;
  const role = appState.currentRole;

  // ─── 未ログイン ───────────────────────────────
  if (!role) {
    el.innerHTML = `
      <nav class="nav-section">
        <div class="nav-section-label">メニュー</div>
        <button class="nav-tab next-target" id="tab-login" onclick="jumpToState('未ログイン')">
          <i class="ti ti-login"></i>ログイン
        </button>
      </nav>`;
    return;
  }

  // ─── アルバイト ───────────────────────────────
  if (role === ROLES.PART_TIME) {
    const workSummary = calcWorkSummary(appState.currentStaff);
    el.innerHTML = `
      <nav class="nav-section">
        <div class="nav-section-label">マイメニュー</div>
        <button class="nav-tab" id="tab-shift-req" onclick="jumpToState('勤務希望未提出')">
          <i class="ti ti-calendar-event"></i>勤務希望
        </button>
        <button class="nav-tab" id="tab-shift-check" onclick="jumpToState('シフト公開済')">
          <i class="ti ti-eye"></i>シフト確認
        </button>
        <button class="nav-tab" id="tab-attendance" onclick="jumpToState('出勤前')">
          <i class="ti ti-clock"></i>打刻
        </button>
        <button class="nav-tab" id="tab-absence" onclick="showAbsencePanel()">
          <i class="ti ti-calendar-x"></i>欠勤申請
        </button>
        <button class="nav-tab" id="tab-replace" onclick="showReplacementPanel()">
          <i class="ti ti-repeat"></i>代替応募
        </button>
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">勤務実態</div>
        <button class="nav-tab" id="tab-work-current" onclick="showWorkSummary('current')">
          <i class="ti ti-chart-bar"></i>当月
          ${workSummary.current.shifts > 0
            ? '<span class="tab-badge">' + workSummary.current.shifts + '件</span>'
            : ''}
        </button>
        <button class="nav-tab" id="tab-work-history" onclick="showWorkSummary('history')">
          <i class="ti ti-history"></i>過去3ヶ月
          ${workSummary.history.totalShifts > 0
            ? '<span class="tab-badge">' + workSummary.history.totalShifts + '件</span>'
            : ''}
        </button>
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">アカウント</div>
        <button class="nav-tab" onclick="doLogout()">
          <i class="ti ti-logout"></i>ログアウト
        </button>
      </nav>`;
    return;
  }

  // ─── 店長 ─────────────────────────────────────
  if (role === ROLES.MANAGER) {
    const store = appState.currentStaff?.store;
    const phase = getShiftPhase(store);
    const shiftNavHtml = (() => {
      if (phase === 'creating') return `
        <button class="nav-tab next-target" id="tab-shift-mgmt" onclick="gotoShiftPhase()">
          <i class="ti ti-layout-grid"></i>シフト作成中
        </button>`;
      if (phase === 'confirmed') return `
        <button class="nav-tab" id="tab-shift-mgmt" onclick="gotoShiftPhase()">
          <i class="ti ti-layout-grid"></i>シフト割当<span class="tab-badge">確定済</span>
        </button>
        <button class="nav-tab next-target" onclick="appState.currentState=STATES.SHIFT_CONFIRMED; updateGuideOnStateChange()">
          <i class="ti ti-send"></i>確定内容確認・公開
        </button>`;
      if (phase === 'published') return `
        <button class="nav-tab" id="tab-shift-mgmt" onclick="gotoShiftPhase()">
          <i class="ti ti-layout-grid"></i>シフト割当<span class="tab-badge">公開済</span>
        </button>
        <button class="nav-tab done" onclick="appState.currentState=STATES.SHIFT_CONFIRMED; updateGuideOnStateChange()">
          <i class="ti ti-send"></i>確定内容<span class="tab-badge">公開済</span>
        </button>`;
      return '';
    })();
    el.innerHTML = `
      <nav class="nav-section">
        <div class="nav-section-label">シフト管理</div>
        ${shiftNavHtml}
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">自分の勤務</div>
        <button class="nav-tab" id="tab-my-clock" onclick="jumpToMyWork()">
          <i class="ti ti-clock"></i>打刻（自分）
        </button>
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">勤怠管理</div>
        <button class="nav-tab" id="tab-attendance" onclick="jumpToState('勤怠未確定')">
          <i class="ti ti-clipboard-check"></i>勤怠確認・確定
        </button>
        <button class="nav-tab" id="tab-ot-approve" onclick="showApprovalPanel('overtime')">
          <i class="ti ti-clock-plus"></i>残業承認
        </button>
        <button class="nav-tab" id="tab-abs-approve" onclick="showApprovalPanel('absence')">
          <i class="ti ti-calendar-x"></i>欠勤承認
        </button>
      </nav>
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">シフトタイムライン</div>
        <button class="nav-tab" id="tab-timeline-today" onclick="showTimeline('today')">
          <i class="ti ti-timeline"></i>当日
        </button>
        <button class="nav-tab" id="tab-timeline-10days" onclick="showTimeline('10days')">
          <i class="ti ti-calendar-week"></i>前後10日（20日分）
        </button>
        <button class="nav-tab" id="tab-timeline-range" onclick="showTimeline('range')">
          <i class="ti ti-calendar-search"></i>前後30日
        </button>
        <button class="nav-tab" id="tab-timeline-future" onclick="showTimeline('future')">
          <i class="ti ti-calendar-stats"></i>今後3ヶ月
        </button>
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">その他</div>
        <button class="nav-tab" id="tab-notify" onclick="jumpToState('通知送信失敗')">
          <i class="ti ti-bell"></i>通知センター
        </button>
        <button class="nav-tab" onclick="doLogout()">
          <i class="ti ti-logout"></i>ログアウト
        </button>
      </nav>`;
    return;
  }

  // ─── 管理者 ───────────────────────────────────
  if (role === ROLES.ADMIN) {
    el.innerHTML = `
      <nav class="nav-section">
        <div class="nav-section-label">自分の勤務</div>
        <button class="nav-tab" id="tab-my-clock" onclick="jumpToMyWork()">
          <i class="ti ti-clock"></i>打刻（自分）
        </button>
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">スタッフ管理</div>
        <button class="nav-tab" onclick="jumpToState('シフト作成中')">
          <i class="ti ti-layout-grid"></i>シフト管理
        </button>
        <button class="nav-tab" id="tab-attendance" onclick="jumpToState('勤怠未確定')">
          <i class="ti ti-clipboard-check"></i>勤怠確定
        </button>
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">給与・経理</div>
        <button class="nav-tab" id="tab-salary" onclick="jumpToState('給与未計算')">
          <i class="ti ti-coin"></i>給与計算
        </button>
        <button class="nav-tab" onclick="showToast('Undefined: CSV項目定義')">
          <i class="ti ti-download"></i>CSV出力
        </button>
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">システム</div>
        <button class="nav-tab" id="tab-notify" onclick="jumpToState('通知送信失敗')">
          <i class="ti ti-bell"></i>通知センター
        </button>
        <button class="nav-tab" onclick="showToast('Undefined: 監査ログUI')">
          <i class="ti ti-shield"></i>監査ログ
        </button>
        <button class="nav-tab" onclick="showToast('Undefined: バックアップ復元方式')">
          <i class="ti ti-database"></i>バックアップ
        </button>
        <button class="nav-tab" onclick="doLogout()">
          <i class="ti ti-logout"></i>ログアウト
        </button>
      </nav>`;
    return;
  }
}

/* ─── 自分の打刻画面へ（店長・管理者用） ─── */
function jumpToMyWork() {
  const s = appState.currentStaff;
  if (!s) return;

  // 打刻データを正として状態を決定（stateより打刻データを優先）
  if (s.clockIn && s.clockOut) {
    // 退勤済み → 勤怠未確定
    appState.currentState = STATES.ATTENDANCE_PENDING;
    updateStaff({ state: STATES.ATTENDANCE_PENDING });
  } else if (s.clockIn && !s.clockOut) {
    // 出勤打刻済・退勤前 → 休憩中か出勤中
    if (appState.currentState !== STATES.ON_BREAK) {
      appState.currentState = STATES.WORKING;
      updateStaff({ state: STATES.WORKING });
    }
    appState.workStart = appState.workStart || parseHHMM(s.clockIn);
  } else {
    // 未打刻 → 出勤前
    appState.currentState = STATES.PRE_WORK;
    updateStaff({ state: STATES.PRE_WORK });
  }

  updateGuideOnStateChange();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─── シフトフェーズに応じた画面へ（店長用） ─── */
function gotoShiftPhase(forceCreating) {
  const store = appState.currentStaff?.store;
  const phase = getShiftPhase(store);
  if (forceCreating || phase === 'creating') {
    appState.currentState = STATES.SHIFT_CREATING;
  } else if (phase === 'confirmed') {
    // confirmedフェーズはSHIFT_CREATINGのままで割当確定可能
    appState.currentState = STATES.SHIFT_CREATING;
  } else if (phase === 'published') {
    appState.currentState = STATES.SHIFT_CREATING;
  }
  updateGuideOnStateChange();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─── 代替応募パネル表示（サイドバーボタン用） ─── */
/* ─── シフトタイムライン（店長用） ─── */
function showTimeline(mode) {
  const me = appState.currentStaff;
  if (!me) return;
  const mainView = document.getElementById('main-view');
  if (!mainView) return;

  // タブ強調
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('next-target'));
  const tabId = { today:'tab-timeline-today', range:'tab-timeline-range', future:'tab-timeline-future' }[mode];
  document.getElementById(tabId)?.classList.add('next-target');

  const today = new Date();
  // JST（ローカル時刻）で今日の日付を取得（toISOStringはUTCのため日本では1日ずれる場合あり）
  const todayStr = today.getFullYear() + '-'
    + String(today.getMonth() + 1).padStart(2, '0') + '-'
    + String(today.getDate()).padStart(2, '0');

  // confirmedShiftsの日付一覧（この店舗）
  const storeConfirmedDates = (DEMO.confirmedShifts || [])
    .filter(c => { const st2 = DEMO.staff.find(s => s.id === c.staffId); return st2?.store === me.store; })
    .map(c => c.date)
    .sort();

  // 基準日：常に今日（todayStr）を使用
  const demoBaseDate = todayStr;

  // 日付ピッカーの範囲を決定
  const rangeLabel = { today:'当日', range:'前後30日', future:'今後3ヶ月' }[mode];

  // 前後10日：日付選択なし・20日分一括表示
  if (mode === '10days') {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('next-target'));
    document.getElementById('tab-timeline-10days')?.classList.add('next-target');
    mainView.innerHTML = `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-calendar-week"></i> シフトタイムライン（前後10日・20日分）</h2>
        <div class="info-row">
          <span class="info-label">店舗</span>
          <span class="staff-name-chip">${me.store}</span>
        </div>
        <div class="info-row">
          <span class="info-label">基準日</span>
          <span>${demoBaseDate}</span>
        </div>
        <div id="timeline-body"></div>
      </div>`;
    renderMultiDayTimeline(demoBaseDate, me.store, 10, 10);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  let minDate, maxDate, defaultDate;
  if (mode === 'today') {
    // 「当日」＝確定シフトのある最初の日（デモ用）
    minDate = maxDate = defaultDate = demoBaseDate;
  } else if (mode === 'range') {
    // 前後30日：デモ基準日を中心に
    const base = new Date(demoBaseDate);
    const dm30 = new Date(base); dm30.setDate(dm30.getDate() - 30);
    const dp30 = new Date(base); dp30.setDate(dp30.getDate() + 30);
    const fmt = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    minDate = fmt(dm30);
    maxDate = fmt(dp30);
    defaultDate = demoBaseDate;
  } else {
    // 今後3ヶ月：デモ基準日から
    const base = new Date(demoBaseDate);
    const d3m  = new Date(base); d3m.setMonth(d3m.getMonth() + 3);
    const fmt2 = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    minDate = demoBaseDate;
    maxDate = fmt2(d3m);
    defaultDate = demoBaseDate;
  }

  // 当日モードは日付入力なし・todayStrを直接渡す
  if (mode === 'today') {
    mainView.innerHTML = `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-timeline"></i> シフトタイムライン（当日）</h2>
        <div class="info-row"><span class="info-label">店舗</span><span class="staff-name-chip">${me.store}</span></div>
        <div class="info-row"><span class="info-label">日付</span><span style="font-weight:600">${todayStr}</span></div>
        <div id="timeline-body" style="margin-top:12px"></div>
      </div>`;
    renderTimelineFor(todayStr, me.store);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  mainView.innerHTML = `
    <div class="view-card">
      <h2 class="view-title"><i class="ti ti-timeline"></i> シフトタイムライン（${rangeLabel}）</h2>
      <div class="info-row">
        <span class="info-label">店舗</span>
        <span class="staff-name-chip">${me.store}</span>
      </div>
      <div class="form-group" style="margin-top:8px">
        <label>日付選択</label>
        <input type="date" id="timeline-date"
          value="${defaultDate}" min="${minDate}" max="${maxDate}"
          oninput="renderTimelineFor(this.value, '${me.store}')" />
      </div>
      <div id="timeline-body" style="margin-top:12px"></div>
    </div>`;

  // 初期描画
  renderTimelineFor(defaultDate, me.store);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* 指定日・指定店舗のタイムラインを描画 */
function renderTimelineFor(dateStr, store) {
  const el = document.getElementById('timeline-body');
  if (!el || !dateStr) return;

  const DOW = ['日','月','火','水','木','金','土'];
  const d   = new Date(dateStr);
  const label = dateStr.slice(5).replace('-','/') + '（' + DOW[d.getDay()] + '）';
  const _now = new Date();
  const todayStr = _now.getFullYear() + '-'
    + String(_now.getMonth() + 1).padStart(2, '0') + '-'
    + String(_now.getDate()).padStart(2, '0');
  const isPast   = dateStr < todayStr;
  const isToday  = dateStr === todayStr;
  const isFuture = dateStr > todayStr;

  // この日のconfirmedShifts（この店舗）
  const storePartIds = new Set(
    DEMO.staff.filter(s => s.role === ROLES.PART_TIME && s.store === store).map(s => s.id)
  );
  const dayShifts = (DEMO.confirmedShifts || [])
    .filter(c => c.date === dateStr && storePartIds.has(c.staffId))
    .map(c => {
      const st = DEMO.staff.find(s => s.id === c.staffId);
      return { ...c, name: st?.name || '?', clockIn: st?.clockIn, clockOut: st?.clockOut, state: st?.state, hourlyRate: st?.hourlyRate };
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  if (dayShifts.length === 0) {
    el.innerHTML = '<div class="warn-box"><i class="ti ti-info-circle"></i> ' + label + ' の確定シフトはありません</div>';
    return;
  }

  // タイムライン描画（6:00〜24:00）
  const START_H = 6, END_H = 24, TOTAL_H = END_H - START_H;
  const BAR_W = 100; // %

  // 時間軸ヘッダー
  const hourTicks = [];
  for (let h = START_H; h <= END_H; h += 2) {
    const pct = (h - START_H) / TOTAL_H * 100;
    hourTicks.push(`<div class="tl-tick" style="left:${pct}%">${h}:00</div>`);
  }

  // 現在時刻ライン（当日のみ）
  let nowLine = '';
  if (isToday) {
    const now = new Date();
    const nowH = now.getHours() + now.getMinutes() / 60;
    if (nowH >= START_H && nowH <= END_H) {
      const pct = (nowH - START_H) / TOTAL_H * 100;
      nowLine = `<div class="tl-now-line" style="left:${pct}%"><div class="tl-now-label">NOW</div></div>`;
    }
  }

  // シフトバー
  const bars = dayShifts.map(s => {
    const [sh, sm] = s.start.split(':').map(Number);
    const [eh, em] = s.end.split(':').map(Number);
    const startPct = Math.max(0, (sh + sm/60 - START_H) / TOTAL_H * 100);
    const endPct   = Math.min(100, (eh + em/60 - START_H) / TOTAL_H * 100);
    const widthPct = endPct - startPct;

    // 状態に応じた色
    let barColor = 'var(--color-primary)';
    let barOpacity = '1';
    let statusMark = '';
    if (isFuture) { barColor = '#9ab8d8'; barOpacity = '0.8'; }
    if (isToday || isPast) {
      if (s.state === '出勤中' || s.state === '休憩中') { barColor = '#2d7a4f'; statusMark = ' 🟢'; }
      else if (s.clockOut) { barColor = '#888'; statusMark = ' ✓'; }
      else if (s.state === '欠勤申請中' || s.state === '代替募集中') { barColor = '#a32d2d'; barOpacity='0.7'; statusMark = ' ✗欠'; }
    }

    // 実打刻バー（当日・過去）
    let actualBar = '';
    if ((isToday || isPast) && s.clockIn) {
      const [aih, aim] = s.clockIn.split(':').map(Number);
      const aeh = s.clockOut ? s.clockOut.split(':').map(Number) : [new Date().getHours(), new Date().getMinutes()];
      const actualStart = Math.max(0, (aih + aim/60 - START_H) / TOTAL_H * 100);
      const actualEnd   = Math.min(100, (aeh[0] + aeh[1]/60 - START_H) / TOTAL_H * 100);
      const actualW     = actualEnd - actualStart;
      if (actualW > 0) {
        actualBar = `<div class="tl-actual-bar" style="left:${actualStart}%;width:${actualW}%;background:${barColor};opacity:.35"></div>`;
      }
    }

    return `
      <div class="tl-row">
        <div class="tl-name">${s.name}${statusMark}</div>
        <div class="tl-track">
          ${actualBar}
          <div class="tl-shift-bar" style="left:${startPct}%;width:${widthPct}%;background:${barColor};opacity:${barOpacity}"
            title="${s.name}: ${s.start}〜${s.end}">
            <span class="tl-shift-label">${s.start}〜${s.end}</span>
          </div>
        </div>
        <div class="tl-info">${s.hourlyRate ? '¥'+s.hourlyRate : '—'}</div>
      </div>`;
  }).join('');

  // 集計
  const totalStaff = dayShifts.length;
  const working    = dayShifts.filter(s => s.state === '出勤中' || s.state === '休憩中').length;
  const done       = dayShifts.filter(s => s.clockOut).length;

  el.innerHTML = `
    <div class="tl-header-row">
      <span class="tl-date-label">${label}</span>
      <div class="tl-stats">
        <span class="badge-ok" style="font-size:11px">${totalStaff}名配置</span>
        ${isToday ? '<span class="badge-ok" style="font-size:11px">出勤中 '+working+'名</span>' : ''}
        ${isPast  ? '<span class="badge-warn" style="font-size:11px">退勤済 '+done+'名</span>' : ''}
        ${isFuture? '<span class="sl-info" style="font-size:11px;padding:2px 8px;border-radius:10px">予定</span>' : ''}
      </div>
    </div>
    <div class="tl-container">
      <div class="tl-axis"><div class="tl-axis-track">${hourTicks.join('')}</div></div>
      <div class="tl-body">
        ${nowLine}
        ${bars}
      </div>
    </div>
    <p class="hint" style="margin-top:8px">
      ${isToday ? '■ 濃い色 = 実打刻実績　□ 薄い色 = シフト予定' : isFuture ? '予定シフトの表示です' : '過去のシフト実績'}
    </p>`;
}

/* ─── 複数日タイムライン（前後N日分を一括表示） ─── */
function renderMultiDayTimeline(baseDateStr, store, daysBefore, daysAfter) {
  const el = document.getElementById('timeline-body');
  if (!el) return;

  const DOW = ['日','月','火','水','木','金','土'];
  const START_H = 6, END_H = 24, TOTAL_H = END_H - START_H;

  // 表示対象の日付リストを生成
  const dates = [];
  const base  = new Date(baseDateStr + 'T00:00:00');
  for (let i = -daysBefore; i <= daysAfter; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0,10));
  }

  // この店舗のアルバイトIDセット
  const storePartIds = new Set(
    DEMO.staff.filter(s => s.role === ROLES.PART_TIME && s.store === store).map(s => s.id)
  );

  // 確定シフトを日付→スタッフ別に整理
  const shiftsByDate = {};
  (DEMO.confirmedShifts || [])
    .filter(c => storePartIds.has(c.staffId))
    .forEach(c => {
      if (!shiftsByDate[c.date]) shiftsByDate[c.date] = [];
      const st = DEMO.staff.find(s => s.id === c.staffId);
      shiftsByDate[c.date].push({ ...c, name: st?.name || '?', state: st?.state, clockIn: st?.clockIn, clockOut: st?.clockOut });
    });

  // 時間軸ヘッダー（共通）
  const hourTicks = [];
  for (let h = START_H; h <= END_H; h += 2) {
    const pct = (h - START_H) / TOTAL_H * 100;
    hourTicks.push('<div class="tl-tick" style="left:' + pct + '%">' + h + ':00</div>');
  }
  const axisHtml = '<div class="tl-axis"><div class="tl-axis-track">' + hourTicks.join('') + '</div></div>';

  // 日付ブロックを生成
  const blocks = dates.map(dateStr => {
    const d       = new Date(dateStr + 'T00:00:00');
    const dow     = DOW[d.getDay()];
    const isBase  = dateStr === baseDateStr;
    const isPast  = dateStr < baseDateStr;
    const isSun   = d.getDay() === 0;
    const isSat   = d.getDay() === 6;
    const dayShifts = (shiftsByDate[dateStr] || []).sort((a,b) => a.start.localeCompare(b.start));

    const dateLabel = dateStr.slice(5).replace('-','/') + '(' + dow + ')';
    const headerColor = isBase
      ? 'var(--color-primary)'
      : isSun ? 'var(--color-error, #a32d2d)'
      : isSat ? '#5b7ab8'
      : 'var(--color-text-2)';
    const bgColor = isBase ? 'var(--color-active-bg, #eef5fc)' : 'transparent';

    // シフトなしの日
    if (dayShifts.length === 0) {
      return '<div class="tl-day-block" style="background:' + bgColor + ';border-left:3px solid ' + (isBase ? 'var(--color-primary)' : 'var(--color-border)') + '">'
        + '<div class="tl-day-header" style="color:' + headerColor + '">'
        + dateLabel
        + (isBase ? ' <span style="font-size:10px;background:var(--color-primary);color:#fff;padding:1px 6px;border-radius:8px;margin-left:4px">基準日</span>' : '')
        + '</div>'
        + '<div style="padding:4px 10px 8px;font-size:11px;color:var(--color-text-3)">シフトなし</div>'
        + '</div>';
    }

    // シフトバー
    const bars = dayShifts.map(s => {
      const [sh,sm] = s.start.split(':').map(Number);
      const [eh,em] = s.end.split(':').map(Number);
      const startPct = Math.max(0, (sh + sm/60 - START_H) / TOTAL_H * 100);
      const widthPct = Math.min(100 - startPct, (eh + em/60 - sh - sm/60) / TOTAL_H * 100);
      let barColor = isPast ? '#aaa' : 'var(--color-primary)';
      if (s.state === '出勤中' || s.state === '休憩中') barColor = '#2d7a4f';
      if (s.state === '欠勤申請中' || s.state === '代替募集中') barColor = '#a32d2d';
      const statusMark = s.state === '出勤中' ? ' 🟢' : s.clockOut ? ' ✓' : s.state === '欠勤申請中' ? ' ✗' : '';
      return '<div class="tl-row">'
        + '<div class="tl-name" style="font-size:11px">' + s.name + statusMark + '</div>'
        + '<div class="tl-track">'
        + '<div class="tl-shift-bar" style="left:' + startPct + '%;width:' + widthPct + '%;background:' + barColor + '" title="' + s.name + ': ' + s.start + '〜' + s.end + '">'
        + '<span class="tl-shift-label">' + s.start + '〜' + s.end + '</span>'
        + '</div>'
        + '</div>'
        + '<div class="tl-info">' + dayShifts.length + '名</div>'
        + '</div>';
    });

    return '<div class="tl-day-block" style="background:' + bgColor + ';border-left:3px solid ' + (isBase ? 'var(--color-primary)' : 'var(--color-border)') + '">'
      + '<div class="tl-day-header" style="color:' + headerColor + ';display:flex;align-items:center;gap:6px">'
      + '<span>' + dateLabel + '</span>'
      + (isBase ? '<span style="font-size:10px;background:var(--color-primary);color:#fff;padding:1px 6px;border-radius:8px">基準日</span>' : '')
      + '<span style="font-size:10px;color:var(--color-text-3);margin-left:auto">' + dayShifts.length + '名</span>'
      + '</div>'
      + '<div class="tl-container" style="margin:4px 10px 8px">'
      + axisHtml
      + '<div class="tl-body">' + bars.join('') + '</div>'
      + '</div>'
      + '</div>';
  });

  el.innerHTML = '<div class="tl-multi-wrap">' + blocks.join('') + '</div>';
}

/* ─── 欠勤申請パネル（サイドバーボタン用・状態を変えない） ─── */
function showAbsencePanel() {
  const me = appState.currentStaff;
  if (!me) return;
  const mainView = document.getElementById('main-view');
  if (!mainView) return;

  const myShifts = (DEMO.confirmedShifts || []).filter(c => c.staffId === me.id);
  const DOW = ['日','月','火','水','木','金','土'];
  const shiftOptions = myShifts.length > 0
    ? myShifts.map(c => {
        const d = new Date(c.date);
        return `<option value="${c.date}">${c.date.slice(5).replace('-','/')}(${DOW[d.getDay()]}) ${c.start}〜${c.end}</option>`;
      }).join('')
    : '';

  mainView.innerHTML = `
    <div class="view-card">
      <h2 class="view-title"><i class="ti ti-calendar-x"></i> 欠勤申請</h2>
      <div class="info-row"><span class="info-label">スタッフ</span><span class="staff-name-chip">${me.name}（${me.store}）</span></div>
      ${myShifts.length === 0
        ? '<div class="warn-box"><i class="ti ti-info-circle"></i> 確定シフトがないため欠勤申請できません。シフト公開後に申請してください。</div>'
        : `<div class="form-group">
            <label>欠勤するシフト</label>
            <select id="inp-absence-shift">${shiftOptions}</select>
          </div>
          <div class="form-group">
            <label>欠勤理由</label>
            <textarea id="inp-absence-reason" rows="3" placeholder="理由を入力してください"></textarea>
          </div>
          <button class="btn-warn" id="btn-absence-send-panel">欠勤申請を送信する</button>`
      }
      <p class="hint">承認後、店長が代替スタッフを手配します。</p>
    </div>`;

  const btn = document.getElementById('btn-absence-send-panel');
  if (btn) {
    btn.addEventListener('click', () => {
      const shiftDate = document.getElementById('inp-absence-shift')?.value;
      const reason    = document.getElementById('inp-absence-reason')?.value || '';
      if (!shiftDate) { showError('欠勤するシフトを選択してください'); return; }
      appState.currentState = STATES.ABSENCE_APPLYING;
      updateStaff({ state: STATES.ABSENCE_APPLYING, note: `欠勤申請: ${shiftDate} ${reason || '理由未記入'}` });
      logT('ABSENCE_APPLY', `${me.name} が ${shiftDate} の欠勤を申請`);
      showToast('欠勤申請を送信しました');
      updateGuideOnStateChange();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('next-target'));
  const tabEl = document.getElementById('tab-absence');
  if (tabEl) tabEl.classList.add('next-target');
}

function showReplacementPanel() {
  const me = appState.currentStaff;
  if (!me) return;
  const mainView = document.getElementById('main-view');
  if (!mainView) return;

  const DOW = ['日','月','火','水','木','金','土'];

  // 自分が欠勤承認済み（REPLACEMENT_OPEN）の場合 → 自分のシフトの募集状況
  if (me.state === STATES.REPLACEMENT_OPEN) {
    const myReqs = DEMO.shiftRequests.filter(r => r.staffId === me.id);
    const shiftInfo = myReqs.length > 0
      ? (() => { const r = myReqs[0]; const d = new Date(r.date); return `${r.date.slice(5).replace('-','/')}(${DOW[d.getDay()]}) ${r.start}〜${r.end}`; })()
      : '未定';
    mainView.innerHTML = `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-repeat"></i> 代替募集中（自分のシフト）</h2>
        <div class="info-row"><span class="info-label">スタッフ</span><span class="staff-name-chip">${me.name}（${me.store}）</span></div>
        <div class="warn-box"><i class="ti ti-info-circle"></i> あなたの欠勤が承認され、代替スタッフを募集しています</div>
        <div class="info-row"><span class="info-label">募集シフト</span><span>${shiftInfo}</span></div>
        <div class="info-row"><span class="info-label">応募状況</span><span class="badge-warn">募集中</span></div>
        <p class="hint">店長が代替スタッフを決定次第、通知されます。</p>
      </div>`;
  } else {
    // それ以外 → 同じ店舗の代替募集中シフトに応募する画面
    const openSlots = DEMO.staff.filter(s =>
      s.store === me.store &&
      s.state === STATES.REPLACEMENT_OPEN &&
      s.id !== me.id
    );
    const slotRows = openSlots.flatMap(absent => {
      const reqs = DEMO.shiftRequests.filter(r => r.staffId === absent.id);
      return reqs.map(r => {
        const d = new Date(r.date);
        const label = `${r.date.slice(5).replace('-','/')}(${DOW[d.getDay()]})`;
        return `
          <div class="approval-row">
            <div class="approval-info">
              <span class="approval-name">${label} ${r.start}〜${r.end}</span>
              <span class="approval-detail">${absent.store} ／ 時給 ¥${absent.hourlyRate || '—'}</span>
              <span class="approval-note">欠員：${absent.name}さんの代替</span>
            </div>
            <div class="approval-btns">
              <button class="btn-primary" onclick="applyReplacement(${absent.id}, '${r.date}')">応募する</button>
            </div>
          </div>`;
      });
    }).join('');

    mainView.innerHTML = `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-repeat"></i> 代替シフト応募</h2>
        <div class="info-row"><span class="info-label">スタッフ</span><span class="staff-name-chip">${me.name}（${me.store}）</span></div>
        <div class="info-row">
          <span class="info-label">募集中件数</span>
          <span class="${openSlots.length > 0 ? 'badge-warn' : 'badge-ok'}">${openSlots.length}件</span>
        </div>
        ${openSlots.length > 0
          ? `<div class="approval-list" style="margin-top:8px">${slotRows}</div>`
          : '<div class="badge-success-lg">現在、代替募集中のシフトはありません</div>'
        }
        <p class="hint">応募後、店長が確定します。</p>
      </div>`;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('next-target'));
  const tabEl = document.getElementById('tab-replace');
  if (tabEl) tabEl.classList.add('next-target');
}

/* ─── 代替応募（アルバイト用） ─── */
function applyReplacement(absentStaffId, date) {
  const absent  = DEMO.staff.find(s => s.id === absentStaffId);
  const me      = appState.currentStaff;
  if (!absent || !me) return;

  // 応募済みチェック（簡易：noteで管理）
  if (me.note?.includes('代替応募済')) {
    showError('すでに応募済みです');
    return;
  }

  // 応募記録（デモ：メモに記録）
  const req = DEMO.shiftRequests.find(r => r.staffId === absentStaffId && r.date === date);
  const info = req ? `${date} ${req.start}〜${req.end}` : date;
  Object.assign(me, { note: `代替応募済: ${absent.name}さんの${info}` });

  logT('REPLACEMENT_APPLY', `${me.name} が ${absent.name}（${info}）の代替に応募`);
  showToast('代替応募しました。店長の確定をお待ちください。');
  renderMainView();
  renderStaffListIfAllowed();
}

/* ─── 残業承認・欠勤承認パネル（店長用） ─── */
function showApprovalPanel(type) {
  const me = appState.currentStaff;
  const mainView = document.getElementById('main-view');
  if (!mainView) return;

  // この店舗のアルバイトを対象に絞る
  const targets = DEMO.staff.filter(s =>
    s.role === ROLES.PART_TIME && s.store === me?.store
  );

  const DOW = ['日','月','火','水','木','金','土'];

  if (type === 'overtime') {
    // 残業申請中のアルバイト一覧
    const applicants = targets.filter(s => s.state === STATES.OVERTIME_APPLYING);
    const rows = applicants.map(s => `
      <div class="approval-row">
        <div class="approval-info">
          <span class="approval-name">${s.name}</span>
          <span class="approval-detail">出勤 ${s.clockIn || '—'} ／ 残業 ${s.overtimeMin}分申請</span>
          <span class="approval-note">${s.note}</span>
        </div>
        <div class="approval-btns">
          <button class="btn-primary" onclick="approveOvertime(${s.id})">承認</button>
          <button class="btn-warn"    onclick="rejectOvertime(${s.id})">却下</button>
        </div>
      </div>`).join('');

    mainView.innerHTML = `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-clock-plus"></i> 残業承認</h2>
        <div class="info-row">
          <span class="info-label">対象店舗</span><span class="staff-name-chip">${me?.store}</span>
        </div>
        <div class="info-row">
          <span class="info-label">申請中</span>
          <span class="${applicants.length > 0 ? 'badge-warn' : 'badge-ok'}">${applicants.length}件</span>
        </div>
        ${applicants.length > 0
          ? `<div class="approval-list">${rows}</div>`
          : '<div class="badge-success-lg">✓ 承認待ちの残業申請はありません</div>'
        }
      </div>`;

  } else {
    // 欠勤申請中のアルバイト一覧
    const applicants = targets.filter(s => s.state === STATES.ABSENCE_APPLYING);
    const rows = applicants.map(s => `
      <div class="approval-row">
        <div class="approval-info">
          <span class="approval-name">${s.name}</span>
          <span class="approval-detail">時給 ¥${s.hourlyRate || '—'} ／ ${s.store}</span>
          <span class="approval-note">${s.note}</span>
        </div>
        <div class="approval-btns">
          <button class="btn-primary" onclick="approveAbsence(${s.id})">承認</button>
          <button class="btn-warn"    onclick="rejectAbsence(${s.id})">却下（代替募集へ）</button>
        </div>
      </div>`).join('');

    mainView.innerHTML = `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-calendar-x"></i> 欠勤承認</h2>
        <div class="info-row">
          <span class="info-label">対象店舗</span><span class="staff-name-chip">${me?.store}</span>
        </div>
        <div class="info-row">
          <span class="info-label">申請中</span>
          <span class="${applicants.length > 0 ? 'badge-error' : 'badge-ok'}">${applicants.length}件</span>
        </div>
        ${applicants.length > 0
          ? `<div class="approval-list">${rows}</div>`
          : '<div class="badge-success-lg">✓ 承認待ちの欠勤申請はありません</div>'
        }
      </div>`;
  }
}

function approveOvertime(staffId) {
  const s = DEMO.staff.find(s => s.id === staffId);
  if (!s) return;
  s.state = STATES.WORKING;
  s.note  = `残業承認済 ${s.overtimeMin}分`;
  logT('OVERTIME_APPROVE', `${s.name} の残業申請を承認`);
  showApprovalPanel('overtime');
  renderStaffListIfAllowed();
}

function rejectOvertime(staffId) {
  const s = DEMO.staff.find(s => s.id === staffId);
  if (!s) return;
  s.state      = STATES.WORKING;
  s.overtimeMin = 0;
  s.note       = '残業却下 → 定時退勤';
  logT('OVERTIME_REJECT', `${s.name} の残業申請を却下`);
  showApprovalPanel('overtime');
  renderStaffListIfAllowed();
}

function approveAbsence(staffId) {
  const s = DEMO.staff.find(s => s.id === staffId);
  if (!s) return;
  s.state = STATES.REPLACEMENT_OPEN;
  s.note  = '欠勤承認 → 代替募集中';
  logT('ABSENCE_APPROVE', `${s.name} の欠勤を承認 → 代替募集へ`);
  showApprovalPanel('absence');
  renderStaffListIfAllowed();
}

function rejectAbsence(staffId) {
  const s = DEMO.staff.find(s => s.id === staffId);
  if (!s) return;
  s.state = STATES.SHIFT_PUBLISHED;
  s.note  = '欠勤却下 → 出勤必須';
  logT('ABSENCE_REJECT', `${s.name} の欠勤申請を却下`);
  showApprovalPanel('absence');
  renderStaffListIfAllowed();
}

/* ─── 個別勤怠確定（店長・管理者用） ─── */
function confirmAttendance(staffId) {
  const s = DEMO.staff.find(s => s.id === Number(staffId));
  if (!s) return;
  ensureClockConsistencyForStaff(s, STATES.ATTENDANCE_PENDING);
  const wm = calcWorkMin(s);
  const est = s.hourlyRate && wm > 0 ? Math.round(s.hourlyRate * wm / 60) : null;
  s.state = STATES.SALARY_PENDING;
  s.note  = `勤怠確定 実働${fmtMinutes(wm)}${est ? ' 概算¥' + est.toLocaleString() : ''}`;
  logT('ATTENDANCE_CONFIRM', `${s.name} の勤怠を確定`);
  renderMainView();          // 画面を再描画（状態一覧を更新）
  renderStaffListIfAllowed();
}

/* ─── シフト割当確定（シフト作成画面の行ボタン） ─── */
function confirmShift(date, staffId) {
  if (!DEMO.confirmedShifts) DEMO.confirmedShifts = [];
  if (!DEMO.pendingShifts)   DEMO.pendingShifts   = [];

  staffId = Number(staffId); // onclick属性から来る場合に文字列になることがあるため

  const store = appState.currentStaff?.store;
  const phase = getShiftPhase(store);
  const name  = DEMO.staff.find(s => s.id === staffId)?.name || staffId;
  const req   = DEMO.shiftRequests.find(r => r.date === date && r.staffId === staffId);
  if (!req) return;

  if (phase === 'published') {
    // 公開済みフェーズ → 仮割当（pendingShifts）に追加、本確定はしない
    const alreadyPending = DEMO.pendingShifts.find(c => c.date === date && c.staffId === staffId);
    const alreadyConfirmed = DEMO.confirmedShifts.find(c => c.date === date && c.staffId === staffId);
    if (!alreadyPending && !alreadyConfirmed) {
      DEMO.pendingShifts.push({ date, staffId, start: req.start, end: req.end });
      logT('SHIFT_PENDING', `${date} ${name} を仮割当（要再確定・再公開）`);
      showToast(`${name} を仮割当しました。「再確定する」を押して公開してください。`);
    }
  } else {
    // 作成中・確定済みフェーズ → confirmedShifts に直接追加
    const already = DEMO.confirmedShifts.find(c => c.date === date && c.staffId === staffId);
    if (!already) {
      DEMO.confirmedShifts.push({ date, staffId, start: req.start, end: req.end });
      logT('SHIFT_ASSIGN', `${date} ${name} を割当確定`);
    }
  }
  if (store) updateDailyShiftStatesForStore(store);
  renderMainView();
  renderStaffListIfAllowed();
  renderTransitionLog();
}

/* ─── ログアウト ─── */
function doLogout() {
  appState.currentStaff  = null;
  appState.currentRole   = null;
  appState.currentState  = STATES.LOGGED_OUT;
  appState.sessionExpiry = null;
  appState.workStart     = null;
  appState.breakStart    = null;
  logT('LOGOUT', 'ログアウトしました');
  updateGuideOnStateChange();
  if (!window.ShiftAPI?.testMode) window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ═══════════════════════════════════════
   外部テスト用 Public API
   window.ShiftAPI 経由で外部JSから操作可能
═══════════════════════════════════════ */
window.ShiftAPI = {
  /* テストモード（trueのときscrollToをスキップ） */
  testMode: false,

  /* 状態取得 */
  getState:        () => ({ ...appState }),
  getCurrentState: () => appState.currentState,
  getCurrentRole:  () => appState.currentRole,
  getCurrentStaff: () => appState.currentStaff ? { ...appState.currentStaff } : null,
  getStaff:        (id) => DEMO.staff.find(s => s.id === id),
  getAllStaff:      () => DEMO.staff.map(s => ({ ...s })),
  getShiftRequests:() => [...DEMO.shiftRequests],
  getConfirmedShifts: () => [...(DEMO.confirmedShifts || [])],
  getPendingShifts:() => [...(DEMO.pendingShifts || [])],
  getShiftPhase:   (store) => getShiftPhase(store),
  getStoreState:   (store) => getStoreState(store),
  getWeeklyShiftState: (store, weekKey) => getWeeklyShiftState(store, weekKey || 'current'),
  getDailyShiftState:  (store, date) => getDailyShiftState(store, date),
  getStoreOperationalSnapshot: (store) => getStoreOperationalSnapshot(store),
  getTransitionLog:() => [...appState.transitionLog],

  /* 操作 */
  loginAsStaff:    (staffId) => loginAsStaff(staffId),
  logout:          () => doLogout(),
  jumpToState:     (state) => jumpToState(state),
  transition:      (event, payload) => transition(event, payload || {}),
  confirmShift:    (date, staffId) => confirmShift(date, staffId),
  confirmAttendance: (staffId) => confirmAttendance(staffId),
  approveOvertime: (staffId) => approveOvertime(staffId),
  rejectOvertime:  (staffId) => rejectOvertime(staffId),
  approveAbsence:  (staffId) => approveAbsence(staffId),
  rejectAbsence:   (staffId) => rejectAbsence(staffId),

  /* テスト用：出勤状態を直接セット */
  setWorking: (staffId) => {
    const id = Number(staffId) || (appState.currentStaff?.id);
    if (!id) return false;
    const staff = DEMO.staff.find(s => s.id === id);
    if (!staff) return false;
    if (appState.currentStaff?.id !== id) loginAsStaff(id);
    appState.workStart    = new Date();
    appState.currentState = STATES.WORKING;
    staff.state = STATES.WORKING;
    ensureClockConsistencyForStaff(staff, STATES.WORKING);
    updateGuideOnStateChange();
    return true;
  },

  setClockIn: (staffId, time) => {
    const staff = DEMO.staff.find(s => s.id === Number(staffId));
    if (!staff) return false;
    staff.clockIn = time;
    return true;
  },

  setClockOut: (staffId, time) => {
    const staff = DEMO.staff.find(s => s.id === Number(staffId));
    if (!staff) return false;
    if (!staff.clockIn) {
      const end = parseHHMM(time) || now();
      staff.clockIn = hhmm(new Date(end.getTime() - 8 * 3600000));
    }
    staff.clockOut = time;
    return true;
  },

  setStaffState: (staffId, state) => {
    const staff = DEMO.staff.find(s => s.id === Number(staffId));
    if (!staff) return false;
    staff.state = state;
    ensureClockConsistencyForStaff(staff, state);
    if (appState.currentStaff?.id === Number(staffId)) {
      appState.currentState = state;
      updateGuideOnStateChange();
    }
    return true;
  },

  setWifi: (connected) => {
    appState.wifiConnected = !!connected;
    updateGuideOnStateChange();
    return true;
  },

  setStoreState: (store, state) => setStoreState(store, state),
  setWeeklyShiftState: (store, weekKey, state) => setWeeklyShiftState(store, weekKey || 'current', state),
  setDailyShiftState: (store, date, state) => setDailyShiftState(store, date, state),
  updateDailyShiftStatesForStore: (store) => { updateDailyShiftStatesForStore(store); return true; },
  normalizeAllClockConsistency: () => { normalizeAllClockConsistency(); updateGuideOnStateChange(); return true; },

  setStaffClock: (staffId, clockIn, clockOut, breakMin) => {
    const staff = DEMO.staff.find(s => s.id === Number(staffId));
    if (!staff) return false;
    if (clockIn  !== undefined) staff.clockIn  = clockIn;
    if (clockOut !== undefined) {
      if (!staff.clockIn && clockOut) {
        const end = parseHHMM(clockOut) || now();
        staff.clockIn = hhmm(new Date(end.getTime() - 8 * 3600000));
      }
      staff.clockOut = clockOut;
    }
    if (breakMin !== undefined) staff.breakMin = breakMin;
    if (staff.clockIn && staff.clockOut) staff.state = STATES.ATTENDANCE_PENDING;
    return true;
  },

  /* フォーム値注入（テスト時に入力欄に値をセット） */
  setFormValue: (id, value) => {
    const el = document.getElementById(id);
    if (el) { el.value = value; return true; }
    return false;
  },

  /* リセット */
  reset: () => {
    doLogout();
    DEMO.shiftRequests  = [];
    DEMO.confirmedShifts = [];
    DEMO.pendingShifts  = [];
    Object.keys(DEMO.shiftPhase || {}).forEach(k => {
      ensureStoreState(k);
      DEMO.storeState[k] = STORE_STATES.OPEN;
      DEMO.weeklyShiftState[k] = { current: WEEKLY_SHIFT_STATES.CREATING };
      DEMO.dailyShiftState[k] = {};
      DEMO.shiftPhase[k] = WEEKLY_SHIFT_STATES.CREATING;
    });
    DEMO.staff.forEach(s => {
      s.state = STATES.LOGGED_OUT;
      s.clockIn = null; s.clockOut = null;
      s.breakMin = 0; s.overtimeMin = 0;
      s.note = '出勤前';
    });
    appState.transitionLog = [];
    updateGuideOnStateChange();
  },

  /* データスナップショット（テストログ用） */
  snapshot: () => ({
    ts: new Date().toISOString(),
    appState: {
      currentState: appState.currentState,
      currentRole:  appState.currentRole,
      currentStaff: appState.currentStaff ? { id: appState.currentStaff.id, name: appState.currentStaff.name } : null,
    },
    staff: DEMO.staff.map(s => ({
      id: s.id, name: s.name, role: s.role, store: s.store,
      state: s.state, clockIn: s.clockIn, clockOut: s.clockOut,
      breakMin: s.breakMin, overtimeMin: s.overtimeMin, note: s.note,
    })),
    shiftRequests:   [...DEMO.shiftRequests],
    confirmedShifts: [...(DEMO.confirmedShifts || [])],
    pendingShifts:   [...(DEMO.pendingShifts   || [])],
    storeState:      JSON.parse(JSON.stringify(DEMO.storeState || {})),
    weeklyShiftState:JSON.parse(JSON.stringify(DEMO.weeklyShiftState || {})),
    dailyShiftState: JSON.parse(JSON.stringify(DEMO.dailyShiftState || {})),
    shiftPhase:      { ...(DEMO.shiftPhase     || {}) },
    transitionLog:   appState.transitionLog.slice(0, 20),
  }),

  /* 整合性チェック（テスト終了時に自動検証） */
  integrityCheck: () => {
    normalizeAllClockConsistency();
    const errors = [];
    const w = (msg) => errors.push(msg);

    // 1. confirmedShiftsのstaffIdは実在するか
    (DEMO.confirmedShifts || []).forEach(c => {
      if (!DEMO.staff.find(s => s.id === c.staffId))
        w('confirmedShifts: 存在しないstaffId=' + c.staffId);
    });

    // 2. 出勤中なのにclockInがない（アルバイトのみ対象）
    DEMO.staff.filter(s =>
      s.role === 'part_time' &&
      (s.state === '出勤中' || s.state === '休憩中')
    ).forEach(s => {
      if (!s.clockIn) w(s.name + ': 出勤中/休憩中なのにclockInがない');
    });

    // 3. 退勤しているのにclockOutがない（アルバイトのみ対象）
    //    管理者・店長は自分が打刻していなくても勤怠未確定・給与未計算になりうる
    DEMO.staff.filter(s =>
      s.role === 'part_time' &&
      (s.state === '勤怠未確定' || s.state === '給与未計算')
    ).forEach(s => {
      if (!s.clockOut) w(s.name + ': ' + s.state + 'なのにclockOutがない');
    });

    // 4. clockIn > clockOut（時刻逆転）
    DEMO.staff.filter(s => s.clockIn && s.clockOut).forEach(s => {
      const [ih,im] = s.clockIn.split(':').map(Number);
      const [oh,om] = s.clockOut.split(':').map(Number);
      if (ih*60+im >= oh*60+om) w(s.name + ': clockIn(' + s.clockIn + ') >= clockOut(' + s.clockOut + ')');
    });

    // 5. 公開済みフェーズなのにconfirmedShiftsが空
    Object.entries(DEMO.shiftPhase || {}).forEach(([store, phase]) => {
      if (phase === 'published') {
        const ok = (DEMO.confirmedShifts || []).some(c => {
          const st = DEMO.staff.find(s => s.id === c.staffId);
          return st?.store === store;
        });
        if (!ok) w(store + ': shiftPhase=publishedなのにconfirmedShiftsが空');
      }
    });

    // 6. 未成年者が深夜帯のシフトに割り当てられていないか
    (DEMO.confirmedShifts || []).forEach(c => {
      const st = DEMO.staff.find(s => s.id === c.staffId);
      if (st?.isMinor) {
        const [eh] = c.end.split(':').map(Number);
        if (eh >= 22 || eh < 5) w(st.name + ': 未成年者が深夜シフト(' + c.end + ')に割り当て');
      }
    });

    // 7. shiftRequestsに重複（同staffId・同date）
    const reqKeys = {};
    DEMO.shiftRequests.forEach(r => {
      const k = r.staffId + '_' + r.date;
      if (reqKeys[k]) w('shiftRequests: 重複 staffId=' + r.staffId + ' date=' + r.date);
      reqKeys[k] = true;
    });

    return { ok: errors.length === 0, errors };
  },

  /* イベント通知（テストランナーが購読できる） */
  _listeners: [],
  on: (fn) => { window.ShiftAPI._listeners.push(fn); },
  off: (fn) => { window.ShiftAPI._listeners = window.ShiftAPI._listeners.filter(f => f !== fn); },
  _emit: (event, data) => { window.ShiftAPI._listeners.forEach(fn => fn(event, data)); },
};

/* 状態変化をテストランナーに通知 */
const _origUpdateGuide = updateGuideOnStateChange;
updateGuideOnStateChange = function() {
  _origUpdateGuide();
  window.ShiftAPI._emit('stateChange', {
    state: appState.currentState,
    role:  appState.currentRole,
    staff: appState.currentStaff?.name,
  });
};


/* BUILD_VERSION: 20260528_dynamic_shift_month */


/* BUILD_VERSION: 20260528_shift_deadline_rule_25 */


/* BUILD_VERSION: 20260528_shift_default_date_fix */


/* BUILD_VERSION: 20260528_today_shift_actual */


/* BUILD_VERSION: 20260528_clock_restrict_shift */


// ─── 打刻不可条件の強化（安全版） ─────────────────────────
function enforceClockButtons() {
    const staff = appState.currentStaff;
    if (!staff) return;

    const isPartTime = appState.currentRole === ROLES.PART_TIME;
    const todayShift = findShiftForStaffByDate(staff?.id, getTodayISO());
    const storeOpen = getStoreState(staff.store) === STORE_STATES.OPEN;
    // アルバイトはシフト必須、店長・管理者はシフト不問
    const shiftOk = isPartTime ? todayShift !== null : true;

    ['btn-clock-in','btn-break-start','btn-break-end','btn-clock-out'].forEach(id => {
        const btn = document.getElementById(id);
        if(btn) btn.disabled = true; // 初期無効化
    });

    if(appState.currentState === STATES.PRE_WORK && shiftOk && storeOpen) {
        const btn = document.getElementById('btn-clock-in'); if(btn) btn.disabled = false;
    }
    if(appState.currentState === STATES.WORKING && shiftOk && storeOpen) {
        const btn1 = document.getElementById('btn-break-start'); if(btn1) btn1.disabled = false;
        const btn2 = document.getElementById('btn-clock-out'); if(btn2) btn2.disabled = false;
    }
    if(appState.currentState === STATES.ON_BREAK && shiftOk && storeOpen) {
        const btn = document.getElementById('btn-break-end'); if(btn) btn.disabled = false;
    }
}

// transition後に常に更新（重複回避済み）
if (typeof old_transition_clockfix === 'undefined') {
    const old_transition_clockfix = transition;
    transition = function(eventName, payload = {}) {
        const result = old_transition_clockfix(eventName, payload);
        enforceClockButtons();
        return result;
    }
} else {
    transition = function(eventName, payload = {}) {
        const result = old_transition_clockfix(eventName, payload);
        enforceClockButtons();
        return result;
    }
}

// DOMContentLoadedで初期更新
window.addEventListener('DOMContentLoaded', () => enforceClockButtons());


/* BUILD_VERSION: 20260528_clock_buttons_fix2 */
