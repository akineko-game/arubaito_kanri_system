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
  SHIFT_REQUEST_SUBMIT:{ from: [STATES.SHIFT_REQ_PENDING],                             to: STATES.SHIFT_REQ_SUBMITTED, roles: [ROLES.PART_TIME] },
  SHIFT_SAVE:          { from: [STATES.SHIFT_CREATING],                                to: STATES.SHIFT_CREATING,      roles: [ROLES.MANAGER] },
  SHIFT_CONFIRM:       { from: [STATES.SHIFT_CREATING],                                to: STATES.SHIFT_CONFIRMED,     roles: [ROLES.MANAGER] },
  SHIFT_PUBLISH:       { from: [STATES.SHIFT_CONFIRMED],                               to: STATES.SHIFT_PUBLISHED,     roles: [ROLES.ADMIN, ROLES.MANAGER] },
  ABSENCE_APPLY:       { from: [STATES.SHIFT_PUBLISHED, STATES.ABSENCE_APPLYING],      to: STATES.ABSENCE_APPLYING,    roles: [ROLES.PART_TIME] },
  CLOCK_IN:            { from: [STATES.PRE_WORK],                                      to: STATES.WORKING,             roles: [ROLES.PART_TIME] },
  BREAK_START:         { from: [STATES.WORKING],                                        to: STATES.ON_BREAK,            roles: [ROLES.PART_TIME] },
  BREAK_END:           { from: [STATES.ON_BREAK],                                       to: STATES.WORKING,             roles: [ROLES.PART_TIME] },
  CLOCK_OUT:           { from: [STATES.WORKING],                                        to: STATES.ATTENDANCE_PENDING,  roles: [ROLES.PART_TIME, ROLES.MANAGER] },
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
    { id:  1, name: '佐藤 健一',   role: ROLES.ADMIN,      state: STATES.SALARY_PENDING,      store: '渋谷店', age: 42, hourlyRate: null, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '全店舗管理担当' },
    { id:  2, name: '高橋 美智子', role: ROLES.ADMIN,      state: STATES.NOTIFY_FAILED,       store: '新宿店', age: 38, hourlyRate: null, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: 'SMTP障害対応中' },
    { id:  3, name: '山田 太郎',   role: ROLES.MANAGER,    state: STATES.SHIFT_CREATING,      store: '渋谷店', age: 35, hourlyRate: null, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '8月シフト作成中' },
    { id:  4, name: '鈴木 恵子',   role: ROLES.MANAGER,    state: STATES.SHIFT_CONFIRMED,     store: '新宿店', age: 31, hourlyRate: null, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '公開待ち' },
    { id:  5, name: '伊藤 誠',     role: ROLES.MANAGER,    state: STATES.ATTENDANCE_PENDING,  store: '池袋店', age: 40, hourlyRate: null, clockIn: '09:55', clockOut: '19:10', breakMin: 60, overtimeMin: 75,  note: '勤怠確認要' },
    { id:  6, name: '渡辺 美香',   role: ROLES.MANAGER,    state: STATES.WORKING,             store: '渋谷店', age: 29, hourlyRate: null, clockIn: '13:00', clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '現在シフト指揮中' },
    { id:  7, name: '田中 花子',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '締切3日前' },
    { id:  8, name: '中村 拓也',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '新宿店', age: 19, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '初月勤務' },
    { id:  9, name: '小林 さくら', role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '池袋店', age: 17, hourlyRate: 1050, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '未成年・深夜禁止', isMinor: true },
    { id: 10, name: '加藤 健太',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '渋谷店', age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '大学生' },
    { id: 11, name: '吉田 あおい', role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '新宿店', age: 25, hourlyRate: 1200, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '週3希望' },
    { id: 12, name: '山本 勇気',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_SUBMITTED, store: '渋谷店', age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '提出済み' },
    { id: 13, name: '松本 優',     role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_SUBMITTED, store: '池袋店', age: 18, hourlyRate: 1050, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '土日中心希望', isMinor: true },
    { id: 14, name: '井上 彩花',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_SUBMITTED, store: '新宿店', age: 23, hourlyRate: 1180, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '平日フル希望' },
    { id: 15, name: '木村 蓮',     role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_SUBMITTED, store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: 'シフト確定待ち' },
    { id: 16, name: '林 奈々',     role: ROLES.PART_TIME,  state: STATES.SHIFT_PUBLISHED,     store: '渋谷店', age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '確認済み' },
    { id: 17, name: '清水 航',     role: ROLES.PART_TIME,  state: STATES.SHIFT_PUBLISHED,     store: '新宿店', age: 24, hourlyRate: 1200, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: 'シフト確認中' },
    { id: 18, name: '山崎 柚子',   role: ROLES.PART_TIME,  state: STATES.SHIFT_PUBLISHED,     store: '池袋店', age: 19, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '欠勤検討中' },
    { id: 19, name: '森 悠斗',     role: ROLES.PART_TIME,  state: STATES.PRE_WORK,            store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '14:00出勤予定' },
    { id: 20, name: '池田 莉子',   role: ROLES.PART_TIME,  state: STATES.PRE_WORK,            store: '新宿店', age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '10:00出勤予定' },
    { id: 21, name: '橋本 颯太',   role: ROLES.PART_TIME,  state: STATES.PRE_WORK,            store: '渋谷店', age: 18, hourlyRate: 1050, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: 'Wi-Fi未接続注意', isMinor: true },
    { id: 22, name: '阿部 千夏',   role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '渋谷店', age: 23, hourlyRate: 1180, clockIn: '09:58', clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '朝番' },
    { id: 23, name: '石川 大翔',   role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '新宿店', age: 25, hourlyRate: 1200, clockIn: '10:03', clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '勤務3時間経過' },
    { id: 24, name: '前田 みずき', role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '池袋店', age: 22, hourlyRate: 1150, clockIn: '13:01', clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '昼番' },
    { id: 25, name: '藤田 蒼',     role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: '17:00', clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '夕方番' },
    { id: 26, name: '岡田 里奈',   role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '新宿店', age: 19, hourlyRate: 1100, clockIn: '18:00', clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '深夜シフト開始前' },
    { id: 27, name: '後藤 翔平',   role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '渋谷店', age: 26, hourlyRate: 1250, clockIn: '08:00', clockOut: null,    breakMin: 60, overtimeMin: 0,   note: '8時間超え間近！' },
    { id: 28, name: '長谷川 葵',   role: ROLES.PART_TIME,  state: STATES.ON_BREAK,            store: '渋谷店', age: 21, hourlyRate: 1150, clockIn: '10:00', clockOut: null,    breakMin: 25, overtimeMin: 0,   note: '休憩中（残5分）' },
    { id: 29, name: '村田 晴菜',   role: ROLES.PART_TIME,  state: STATES.ON_BREAK,            store: '池袋店', age: 20, hourlyRate: 1100, clockIn: '13:00', clockOut: null,    breakMin: 10, overtimeMin: 0,   note: '休憩開始直後' },
    { id: 30, name: '近藤 朔',     role: ROLES.PART_TIME,  state: STATES.ON_BREAK,            store: '新宿店', age: 24, hourlyRate: 1200, clockIn: '11:00', clockOut: null,    breakMin: 45, overtimeMin: 0,   note: '長めの休憩' },
    { id: 31, name: '藤井 結月',   role: ROLES.PART_TIME,  state: STATES.OVERTIME_APPLYING,   store: '渋谷店', age: 22, hourlyRate: 1150, clockIn: '10:00', clockOut: null,    breakMin: 60, overtimeMin: 90,  note: '繁忙期で+1.5h申請' },
    { id: 32, name: '西村 拓海',   role: ROLES.PART_TIME,  state: STATES.OVERTIME_APPLYING,   store: '新宿店', age: 28, hourlyRate: 1300, clockIn: '09:00', clockOut: null,    breakMin: 60, overtimeMin: 120, note: '在庫整理+2h申請' },
    { id: 33, name: '福田 ひより', role: ROLES.PART_TIME,  state: STATES.ABSENCE_APPLYING,    store: '渋谷店', age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '体調不良' },
    { id: 34, name: '岡本 亮',     role: ROLES.PART_TIME,  state: STATES.ABSENCE_APPLYING,    store: '池袋店', age: 23, hourlyRate: 1180, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '家族の緊急事態' },
    { id: 35, name: '遠藤 菜々美', role: ROLES.PART_TIME,  state: STATES.ABSENCE_APPLYING,    store: '新宿店', age: 19, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '試験と重複' },
    { id: 36, name: '青木 陸',     role: ROLES.PART_TIME,  state: STATES.REPLACEMENT_OPEN,    store: '渋谷店', age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '8/1代替募集中' },
    { id: 37, name: '竹内 ゆか',   role: ROLES.PART_TIME,  state: STATES.REPLACEMENT_OPEN,    store: '池袋店', age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '8/3代替募集中' },
    { id: 38, name: '金子 海斗',   role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '渋谷店', age: 24, hourlyRate: 1200, clockIn: '10:00', clockOut: '18:08', breakMin: 60, overtimeMin: 0,   note: '確認待ち' },
    { id: 39, name: '工藤 美羽',   role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '新宿店', age: 20, hourlyRate: 1150, clockIn: '13:02', clockOut: '21:15', breakMin: 60, overtimeMin: 0,   note: '退勤時刻要確認' },
    { id: 40, name: '和田 一輝',   role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '池袋店', age: 22, hourlyRate: 1150, clockIn: '09:55', clockOut: '18:30', breakMin: 60, overtimeMin: 30,  note: '残業あり' },
    { id: 41, name: '斎藤 えみか', role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '渋谷店', age: 21, hourlyRate: 1150, clockIn: '17:00', clockOut: '23:05', breakMin: 45, overtimeMin: 0,   note: '深夜帯含む' },
    { id: 42, name: '横山 蓮太',   role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '新宿店', age: 25, hourlyRate: 1250, clockIn: '08:30', clockOut: '17:00', breakMin: 60, overtimeMin: 0,   note: '打刻正常' },
    { id: 43, name: '内田 朱音',   role: ROLES.PART_TIME,  state: STATES.SALARY_PENDING,      store: '渋谷店', age: 23, hourlyRate: 1180, clockIn: '10:00', clockOut: '18:00', breakMin: 60, overtimeMin: 0,   note: '7月分確定済み' },
    { id: 44, name: '宮崎 大空',   role: ROLES.PART_TIME,  state: STATES.SALARY_PENDING,      store: '池袋店', age: 20, hourlyRate: 1150, clockIn: '13:00', clockOut: '21:00', breakMin: 60, overtimeMin: 0,   note: '7月分確定済み' },
    { id: 45, name: '田村 葉月',   role: ROLES.PART_TIME,  state: STATES.SALARY_PENDING,      store: '新宿店', age: 19, hourlyRate: 1100, clockIn: '09:00', clockOut: '17:00', breakMin: 60, overtimeMin: 0,   note: '7月分確定済み' },
    { id: 46, name: '原田 悠真',   role: ROLES.PART_TIME,  state: STATES.SALARY_PENDING,      store: '渋谷店', age: 26, hourlyRate: 1300, clockIn: '10:00', clockOut: '19:30', breakMin: 60, overtimeMin: 90,  note: '残業込み計算要' },
    { id: 47, name: '松田 柊',     role: ROLES.PART_TIME,  state: STATES.NOTIFY_FAILED,       store: '渋谷店', age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: 'シフト公開通知失敗' },
    { id: 48, name: '石田 あかり', role: ROLES.PART_TIME,  state: STATES.NOTIFY_FAILED,       store: '新宿店', age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '欠勤承認通知失敗' },
    { id: 49, name: '三浦 朝陽',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,          store: '池袋店', age: 20, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '新規スタッフ' },
    { id: 50, name: '坂本 ひな',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,          store: '渋谷店', age: 23, hourlyRate: 1180, clockIn: null,    clockOut: null,    breakMin: 0,  overtimeMin: 0,   note: '産休明け復帰予定' },
  ],
  shiftRequests: [
    { staffId:  7, date: '2025-08-01', start: '10:00', end: '18:00' },
    { staffId:  7, date: '2025-08-03', start: '13:00', end: '21:00' },
    { staffId: 12, date: '2025-08-02', start: '10:00', end: '18:00' },
    { staffId: 13, date: '2025-08-01', start: '10:00', end: '16:00' },
    { staffId: 14, date: '2025-08-02', start: '09:00', end: '17:00' },
  ],
};

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
    case 'LOGIN':              if (!doLogin(payload)) return false; break;
    case 'SHIFT_REQUEST_SUBMIT': doShiftSubmit(payload); break;
    case 'CLOCK_IN':           doClockin(); break;
    case 'BREAK_START':        doBreakStart(); break;
    case 'BREAK_END':          doBreakEnd(); break;
    case 'CLOCK_OUT':          doClockout(); break;
    case 'OVERTIME_APPLY':     doOvertimeApply(payload); break;
    case 'ATTENDANCE_CONFIRM': doAttendanceConfirm(); break;
  }

  appState.currentState = route.to;
  updateStaff({ state: route.to });
  logT(eventName, `${prev} → ${route.to}`);
  updateGuideOnStateChange();
  return true;
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

  // LOGIN event_route の to は SHIFT_REQ_PENDING だが、
  // スタッフが既に別の状態にいる場合はその状態を使う
  // → transition() 内で currentState を上書きする前に state を保存
  appState._loginTargetState = staff.state !== STATES.LOGGED_OUT ? staff.state : null;
  return true;
}

function doShiftSubmit(payload) {
  const date  = document.getElementById('inp-shift-date')?.value  || payload.date  || '2025-08-01';
  const start = document.getElementById('inp-shift-start')?.value || payload.start || '10:00';
  const end   = document.getElementById('inp-shift-end')?.value   || payload.end   || '18:00';
  DEMO.shiftRequests.push({ staffId: appState.currentStaff?.id, date, start, end });
  updateStaff({ note: `${date} ${start}〜${end} 提出済み` });
}

function doClockin() {
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
  const result = _realTransition(eventName, payload);
  if (eventName === 'LOGIN' && result && appState._loginTargetState) {
    appState.currentState = appState._loginTargetState;
    appState._loginTargetState = null;
    // 再レンダーはupdateGuideOnStateChange()が既に呼ばれているので
    // 状態だけ変えてもう一度レンダー
    updateGuideOnStateChange();
  }
  return result;
}

/* ═══════════════════════════════════════
   状態進行モデル
═══════════════════════════════════════ */
const PROGRESS_MODEL = [
  { state: STATES.LOGGED_OUT,          label: 'ログイン',     icon: 'ti-login' },
  { state: STATES.SHIFT_REQ_PENDING,   label: '勤務希望提出', icon: 'ti-calendar-event' },
  { state: STATES.SHIFT_REQ_SUBMITTED, label: '希望提出済',   icon: 'ti-calendar-check' },
  { state: STATES.SHIFT_CREATING,      label: 'シフト作成',   icon: 'ti-layout-grid' },
  { state: STATES.SHIFT_CONFIRMED,     label: 'シフト確定',   icon: 'ti-circle-check' },
  { state: STATES.SHIFT_PUBLISHED,     label: 'シフト公開',   icon: 'ti-eye' },
  { state: STATES.PRE_WORK,            label: '出勤前',       icon: 'ti-clock' },
  { state: STATES.WORKING,             label: '出勤中',       icon: 'ti-briefcase' },
  { state: STATES.ON_BREAK,            label: '休憩中',       icon: 'ti-coffee' },
  { state: STATES.ATTENDANCE_PENDING,  label: '勤怠確認',     icon: 'ti-clipboard-check' },
  { state: STATES.SALARY_PENDING,      label: '給与計算',     icon: 'ti-coin' },
];

function getCurrentProgress() {
  const idx = PROGRESS_MODEL.findIndex(s => s.state === appState.currentState);
  return { idx, total: PROGRESS_MODEL.length, pct: idx < 0 ? 0 : Math.round(idx / (PROGRESS_MODEL.length - 1) * 100) };
}

function getNextAction() {
  const g = {
    [STATES.LOGGED_OUT]:          { cta: 'ログインしてください',           warn: null },
    [STATES.SHIFT_REQ_PENDING]:   { cta: '勤務希望を提出してください',     warn: '締切後は編集できません' },
    [STATES.SHIFT_REQ_SUBMITTED]: { cta: 'シフト確定をお待ちください',     warn: null },
    [STATES.SHIFT_CREATING]:      { cta: '不足時間帯を確認してください',   warn: null },
    [STATES.SHIFT_CONFIRMED]:     { cta: 'シフトを公開してください',       warn: null },
    [STATES.SHIFT_PUBLISHED]:     { cta: '勤務内容を確認してください',     warn: null },
    [STATES.PRE_WORK]:            { cta: '出勤打刻してください',           warn: appState.wifiConnected ? null : '店舗Wi-Fi未接続' },
    [STATES.WORKING]:             { cta: '勤務中です',                     warn: overtimeWarn() },
    [STATES.ON_BREAK]:            { cta: '休憩終了してください',           warn: null },
    [STATES.OVERTIME_APPLYING]:   { cta: '残業申請を送信してください',     warn: null },
    [STATES.ABSENCE_APPLYING]:    { cta: '欠勤申請を完了してください',     warn: null },
    [STATES.REPLACEMENT_OPEN]:    { cta: '代替勤務へ応募してください',     warn: null },
    [STATES.ATTENDANCE_PENDING]:  { cta: '勤怠を確認してください',         warn: null },
    [STATES.SALARY_PENDING]:      { cta: '給与計算を実行してください',     warn: null },
    [STATES.NOTIFY_FAILED]:       { cta: '通知を再送してください',         warn: '通知送信に失敗しています' },
  };
  return g[appState.currentState] || { cta: 'Undefined', warn: null };
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
  const s = appState.currentStaff;
  const whoHtml = s
    ? `<span class="state-who"><i class="ti ti-user"></i>${s.name}（${s.store}）</span>`
    : '';
  const role = ROLE_LABEL[appState.currentRole] || '—';
  const sess = appState.sessionExpiry ? `期限 ${appState.sessionExpiry.toLocaleTimeString('ja-JP')}` : 'セッションなし';
  el.innerHTML = `<div class="state-current">${whoHtml}<span class="state-badge">${appState.currentState}</span><span class="state-meta">${role} | ${sess}</span></div>`;
}

function renderProgressStepper() {
  const el = document.getElementById('progress-stepper');
  if (!el) return;
  const { idx } = getCurrentProgress();
  el.innerHTML = PROGRESS_MODEL.map((step, i) => {
    const cls = i === idx ? 'step active' : i < idx ? 'step done' : 'step pending';
    const dot = i < idx
      ? `<span class="step-badge"><i class="ti ti-check"></i></span>`
      : `<i class="ti ${step.icon}"></i>`;
    return `<div class="${cls}"><div class="step-dot">${dot}</div><div class="step-label">${step.label}</div></div>`
           + (i < PROGRESS_MODEL.length - 1 ? '<div class="step-line"></div>' : '');
  }).join('');
}

function renderGuide() {
  const el = document.getElementById('guide-box');
  if (!el) return;
  const { pct, idx } = getCurrentProgress();
  const guide = getNextAction();
  const s = appState.currentStaff;
  const who = s ? `<span class="guide-who">${s.name}さん</span>` : '';
  const warn = guide.warn ? `<div class="warn-box"><i class="ti ti-alert-triangle"></i> ${guide.warn}</div>` : '';
  el.innerHTML = `
    <div class="guide-cta">${who}${guide.cta}</div>
    ${warn}
    <div class="guide-progress-bar"><div class="guide-progress-fill" style="width:${pct}%"></div></div>
    <div class="guide-progress-label">進捗 ${pct}%（ステップ ${idx + 1} / ${PROGRESS_MODEL.length}）</div>`;
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
  const map = {
    [STATES.LOGGED_OUT]:          'tab-login',
    [STATES.SHIFT_REQ_PENDING]:   'tab-shift-req',
    [STATES.SHIFT_CREATING]:      'tab-shift-mgmt',
    [STATES.SHIFT_CONFIRMED]:     'tab-shift-mgmt',
    [STATES.SHIFT_PUBLISHED]:     'tab-shift-req',
    [STATES.PRE_WORK]:            'tab-attendance',
    [STATES.WORKING]:             'tab-attendance',
    [STATES.ON_BREAK]:            'tab-attendance',
    [STATES.ATTENDANCE_PENDING]:  'tab-attendance',
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
      ? myReqs.map(r => `<div class="shift-row"><span>${r.date}</span><span>${r.start}</span><span>${r.end}</span><span class="badge-ok">登録済</span></div>`).join('')
      : `<div class="shift-row" style="color:var(--color-text-3)"><span colspan="4">まだ登録なし</span></div>`;
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-calendar-event"></i> 勤務希望提出</h2>
        ${staffChip(st)}
        <div class="info-row"><span class="info-label">対象月</span><span>2025年8月</span></div>
        <div class="info-row"><span class="info-label">締切</span><span class="warn-text">2025年7月25日</span></div>
        ${st?.hourlyRate ? `<div class="info-row"><span class="info-label">時給</span><span>¥${st.hourlyRate}</span></div>` : ''}
        <div class="shift-table" style="margin-top:8px">
          <div class="shift-row header"><span>希望日</span><span>開始</span><span>終了</span><span>状態</span></div>
          ${reqRows}
        </div>
        <div class="form-group"><label>希望日を追加</label><input type="date" id="inp-shift-date" value="2025-08-05" /></div>
        <div class="btn-row">
          <div class="form-group" style="flex:1"><label>開始</label><input type="time" id="inp-shift-start" value="10:00" /></div>
          <div class="form-group" style="flex:1"><label>終了</label><input type="time" id="inp-shift-end"   value="18:00" /></div>
        </div>
        <button class="btn-primary" id="btn-shift-submit">この希望を提出して完了</button>
        <p class="hint">⚠ 締切後は編集できません</p>
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
          ${myReqs.map(r => `<div class="shift-row"><span>${r.date}</span><span>${r.start}</span><span>${r.end}</span><span class="badge-ok">✓</span></div>`).join('') || '<div class="shift-row"><span style="color:var(--color-text-3)">データなし</span></div>'}
        </div>
        <p class="hint">店長がシフトを作成中です。公開後にお知らせします。</p>
      </div>`;
  }

  // ─── シフト作成中 ───────────────────────────
  if (state === STATES.SHIFT_CREATING) {
    const submitted = DEMO.staff.filter(s => s.state === STATES.SHIFT_REQ_SUBMITTED || s.state !== STATES.LOGGED_OUT).length;
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-layout-grid"></i> シフト作成</h2>
        ${staffChip(st)}
        <div class="info-grid">
          <div class="info-card"><div class="info-num">${submitted}</div><div>提出済みスタッフ</div></div>
          <div class="info-card warn"><div class="info-num">3</div><div>不足時間帯</div></div>
        </div>
        <div class="shift-table">
          <div class="shift-row header"><span>日付</span><span>スタッフ</span><span>時間</span><span>状態</span></div>
          <div class="shift-row"><span>8/1(月)</span><span>田中 花子</span><span>10:00〜18:00</span><span class="badge-ok">割当済</span></div>
          <div class="shift-row"><span>8/2(火)</span><span>—</span><span>13:00〜21:00</span><span class="badge-warn">未割当</span></div>
          <div class="shift-row"><span>8/3(水)</span><span>—</span><span>10:00〜18:00</span><span class="badge-warn">未割当</span></div>
        </div>
        <div class="btn-row">
          <button class="btn-secondary" id="btn-shift-draft">一時保存</button>
          <button class="btn-primary"   id="btn-shift-confirm">シフトを確定する</button>
        </div>
      </div>`;
  }

  // ─── シフト確定済 ───────────────────────────
  if (state === STATES.SHIFT_CONFIRMED) {
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-circle-check"></i> シフト確定済</h2>
        ${staffChip(st)}
        <div class="badge-success-lg">✓ シフト確定完了</div>
        <p class="view-desc">内容を確認の上、スタッフへ公開してください。</p>
        <button class="btn-primary" id="btn-shift-publish">スタッフへ公開する</button>
      </div>`;
  }

  // ─── シフト公開済 ───────────────────────────
  if (state === STATES.SHIFT_PUBLISHED) {
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-eye"></i> 確定シフト確認</h2>
        ${staffChip(st)}
        <div class="shift-table">
          <div class="shift-row header"><span>日付</span><span>時間</span><span>店舗</span></div>
          <div class="shift-row"><span>8/1(月)</span><span>10:00〜18:00</span><span>${st?.store || '渋谷店'}</span></div>
          <div class="shift-row"><span>8/3(水)</span><span>13:00〜21:00</span><span>${st?.store || '渋谷店'}</span></div>
        </div>
        <button class="btn-warn" id="btn-absence-apply">欠勤申請する</button>
      </div>`;
  }

  // ─── 出勤前 ─────────────────────────────────
  if (state === STATES.PRE_WORK) {
    const wifiOk = appState.wifiConnected;
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-clock"></i> 出勤前</h2>
        ${staffChip(st)}
        <div class="info-row"><span class="info-label">本日シフト</span><span>${st?.store || '渋谷店'} 10:00〜18:00</span></div>
        <div class="info-row"><span class="info-label">Wi-Fi</span>
          <span class="${wifiOk ? 'badge-ok' : 'badge-error'}">${wifiOk ? '接続中' : '未接続'}</span>
        </div>
        <label class="toggle-row">
          <input type="checkbox" id="chk-wifi" ${wifiOk ? 'checked' : ''} />
          <span>Wi-Fiシミュレート（デモ用）</span>
        </label>
        ${!wifiOk ? '<div class="warn-box"><i class="ti ti-wifi-off"></i> オフライン打刻は後で同期されます</div>' : ''}
        <button class="btn-primary btn-xl" id="btn-clock-in">🕐 出勤打刻</button>
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
    return `
      <div class="view-card">
        <h2 class="view-title"><i class="ti ti-repeat"></i> 代替募集</h2>
        ${staffChip(st)}
        <div class="info-row"><span class="info-label">募集シフト</span><span>8/1(月) 10:00〜18:00</span></div>
        <div class="info-row"><span class="info-label">締切</span><span class="warn-text">7/31 23:59</span></div>
        ${st?.hourlyRate ? `<div class="info-row"><span class="info-label">時給</span><span>¥${st.hourlyRate}</span></div>` : ''}
        <button class="btn-primary" id="btn-replacement-apply">代替応募する</button>
      </div>`;
  }

  // ─── 勤怠未確定 ─────────────────────────────
  if (state === STATES.ATTENDANCE_PENDING) {
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
        <div class="btn-row">
          <button class="btn-secondary" id="btn-attendance-fix">打刻修正</button>
          <button class="btn-primary"   id="btn-attendance-confirm">勤怠を確定する</button>
        </div>
        <p class="hint">Undefined: 打刻改ざん対策</p>
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
        <div class="info-row"><span class="info-label">対象月</span><span>2025年8月</span></div>
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
  on('btn-shift-submit', 'click', () => transition('SHIFT_REQUEST_SUBMIT'));
  on('btn-shift-draft',  'click', () => { transition('SHIFT_SAVE'); showToast('一時保存しました'); });
  on('btn-shift-confirm','click', () => transition('SHIFT_CONFIRM'));
  on('btn-shift-publish','click', () => transition('SHIFT_PUBLISH'));

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
  on('btn-attendance-confirm','click', () => transition('ATTENDANCE_CONFIRM'));

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

  const stores = [...new Set(DEMO.staff.map(s => s.store))].sort();
  const stateKeys = [...new Set(DEMO.staff.map(s => s.state))].sort();

  const list = DEMO.staff.filter(s => {
    if (staffFilter.state  !== 'all' && s.state  !== staffFilter.state)  return false;
    if (staffFilter.role   !== 'all' && s.role   !== staffFilter.role)   return false;
    if (staffFilter.store  !== 'all' && s.store  !== staffFilter.store)  return false;
    if (staffFilter.search) {
      const q = staffFilter.search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !s.note.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const counts = {};
  DEMO.staff.forEach(s => { counts[s.state] = (counts[s.state] || 0) + 1; });
  const working  = (counts[STATES.WORKING] || 0) + (counts[STATES.ON_BREAK] || 0);
  const alertCnt = (counts[STATES.ABSENCE_APPLYING] || 0) + (counts[STATES.NOTIFY_FAILED] || 0)
                 + (counts[STATES.OVERTIME_APPLYING] || 0) + (counts[STATES.REPLACEMENT_OPEN] || 0);

  container.innerHTML = `
    <div class="sl-header">
      <div class="sl-title"><i class="ti ti-users"></i> スタッフ一覧 <span class="sl-count">${DEMO.staff.length}名</span></div>
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
      <select onchange="staffFilter.role=this.value; renderStaffList()">
        <option value="all">全ロール</option>
        <option value="${ROLES.ADMIN}"     ${staffFilter.role===ROLES.ADMIN    ?'selected':''}>管理者</option>
        <option value="${ROLES.MANAGER}"   ${staffFilter.role===ROLES.MANAGER  ?'selected':''}>店長</option>
        <option value="${ROLES.PART_TIME}" ${staffFilter.role===ROLES.PART_TIME?'selected':''}>アルバイト</option>
      </select>
      <select onchange="staffFilter.store=this.value; renderStaffList()">
        <option value="all">全店舗</option>
        ${stores.map(s => `<option value="${s}" ${staffFilter.store===s?'selected':''}>${s}</option>`).join('')}
      </select>
    </div>
    <div class="sl-result-count">${list.length}件表示 — <span style="color:var(--color-primary)">行クリックでそのスタッフとしてログイン</span></div>
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
          <div class="sl-row sl-row-body ${active ? 'sl-row-active' : ''}" onclick="loginAsStaff(${s.id})" title="${s.name}としてログイン">
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
function loginAsStaff(staffId) {
  const staff = DEMO.staff.find(s => s.id === staffId);
  if (!staff) return;

  appState.currentStaff  = staff;
  appState.currentRole   = staff.role;
  appState.currentState  = staff.state;
  appState.sessionExpiry = new Date(Date.now() + RULES.SESSION_HOURS * 3600 * 1000);
  appState.workStart     = null;
  appState.breakStart    = null;

  if (staff.clockIn && !staff.clockOut) {
    appState.workStart = parseHHMM(staff.clockIn);
  }
  if (staff.state === STATES.ON_BREAK) {
    appState.breakStart = new Date(Date.now() - (staff.breakMin || 10) * 60000);
  }

  logT('STAFF_LOGIN', `${staff.name}（${ROLE_LABEL[staff.role]}・${staff.store}）でログイン`);
  updateGuideOnStateChange();
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
    el.innerHTML = `
      <nav class="nav-section">
        <div class="nav-section-label">マイメニュー</div>
        <button class="nav-tab" id="tab-shift-req" onclick="jumpToState('勤務希望未提出')">
          <i class="ti ti-calendar-event"></i>勤務希望
        </button>
        <button class="nav-tab" onclick="jumpToState('シフト公開済')">
          <i class="ti ti-eye"></i>シフト確認
        </button>
        <button class="nav-tab" id="tab-attendance" onclick="jumpToState('出勤前')">
          <i class="ti ti-clock"></i>打刻
        </button>
        <button class="nav-tab" onclick="jumpToState('欠勤申請中')">
          <i class="ti ti-calendar-x"></i>欠勤申請
        </button>
        <button class="nav-tab" onclick="jumpToState('代替募集中')">
          <i class="ti ti-repeat"></i>代替応募
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
    el.innerHTML = `
      <nav class="nav-section">
        <div class="nav-section-label">シフト管理</div>
        <button class="nav-tab" id="tab-shift-mgmt" onclick="jumpToState('シフト作成中')">
          <i class="ti ti-layout-grid"></i>シフト作成
        </button>
        <button class="nav-tab" onclick="jumpToState('シフト確定済')">
          <i class="ti ti-circle-check"></i>シフト確定・公開
        </button>
      </nav>
      <nav class="nav-section">
        <div class="nav-section-label">勤怠管理</div>
        <button class="nav-tab" id="tab-attendance" onclick="jumpToState('勤怠未確定')">
          <i class="ti ti-clipboard-check"></i>勤怠確認・確定
        </button>
        <button class="nav-tab" onclick="jumpToState('残業申請中')">
          <i class="ti ti-clock-plus"></i>残業承認
        </button>
        <button class="nav-tab" onclick="jumpToState('欠勤申請中')">
          <i class="ti ti-calendar-x"></i>欠勤承認
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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
