/* ============================================================
   アルバイト管理統合システム — app.js
   状態機械 + UI誘導エンジン
   ============================================================ */

/* ----------------------------------------------------------
   UNDEFINED ITEMS (SDS未定義):
   - シフト同時編集競合制御
   - 打刻改ざん対策
   - GPS併用
   - CSV項目定義
   - バックアップ復元方式
   - 通知テンプレ編集
   - 臨時休業中の給与扱い
   - 労基法警告範囲
   - 店舗管理機能詳細
   - 将来LINE認証方式
   ---------------------------------------------------------- */

/* ---- 権限定義 ---- */
const ROLES = { ADMIN: 'admin', MANAGER: 'manager', PART_TIME: 'part_time' };

/* ---- 状態定義 ---- */
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

/* ---- event_routes 定義 ---- */
const EVENT_ROUTES = {
  LOGIN:                   { from: [STATES.LOGGED_OUT],         to: STATES.SHIFT_REQ_PENDING,   roles: [ROLES.ADMIN, ROLES.MANAGER, ROLES.PART_TIME] },
  PASSWORD_RESET:          { from: [STATES.LOGGED_OUT],         to: STATES.LOGGED_OUT,          roles: [ROLES.ADMIN, ROLES.MANAGER, ROLES.PART_TIME] },
  SHIFT_REQUEST_SUBMIT:    { from: [STATES.SHIFT_REQ_PENDING],  to: STATES.SHIFT_REQ_SUBMITTED, roles: [ROLES.PART_TIME] },
  SHIFT_SAVE:              { from: [STATES.SHIFT_CREATING],     to: STATES.SHIFT_CREATING,      roles: [ROLES.MANAGER] },
  SHIFT_CONFIRM:           { from: [STATES.SHIFT_CREATING],     to: STATES.SHIFT_CONFIRMED,     roles: [ROLES.MANAGER] },
  SHIFT_PUBLISH:           { from: [STATES.SHIFT_CONFIRMED],    to: STATES.SHIFT_PUBLISHED,     roles: [ROLES.ADMIN, ROLES.MANAGER] },
  ABSENCE_APPLY:           { from: [STATES.SHIFT_PUBLISHED, STATES.ABSENCE_APPLYING], to: STATES.ABSENCE_APPLYING, roles: [ROLES.PART_TIME] },
  CLOCK_IN:                { from: [STATES.PRE_WORK],           to: STATES.WORKING,             roles: [ROLES.PART_TIME] },
  BREAK_START:             { from: [STATES.WORKING],            to: STATES.ON_BREAK,            roles: [ROLES.PART_TIME] },
  BREAK_END:               { from: [STATES.ON_BREAK],           to: STATES.WORKING,             roles: [ROLES.PART_TIME] },
  CLOCK_OUT:               { from: [STATES.WORKING],            to: STATES.ATTENDANCE_PENDING,  roles: [ROLES.PART_TIME, ROLES.MANAGER] },
  OVERTIME_APPLY:          { from: [STATES.OVERTIME_APPLYING],  to: STATES.WORKING,             roles: [ROLES.PART_TIME] },
  ATTENDANCE_FIX:          { from: [STATES.ATTENDANCE_PENDING], to: STATES.ATTENDANCE_PENDING,  roles: [ROLES.MANAGER, ROLES.ADMIN] },
  ATTENDANCE_CONFIRM:      { from: [STATES.ATTENDANCE_PENDING], to: STATES.SALARY_PENDING,      roles: [ROLES.ADMIN, ROLES.MANAGER] },
  SALARY_CALC:             { from: [STATES.SALARY_PENDING],     to: STATES.SALARY_PENDING,      roles: [ROLES.ADMIN] },
  NOTIFY_RETRY:            { from: [STATES.NOTIFY_FAILED],      to: STATES.NOTIFY_FAILED,       roles: [ROLES.ADMIN, ROLES.MANAGER] },
  REPLACEMENT_APPLY:       { from: [STATES.REPLACEMENT_OPEN],   to: STATES.REPLACEMENT_OPEN,    roles: [ROLES.PART_TIME] },
};

/* ---- 業務ルール ---- */
const RULES = {
  SESSION_HOURS:       8,
  MAX_LOGIN_FAILURES:  5,
  LATE_NIGHT_BONUS:    1.25,
  HOLIDAY_BONUS:       1.35,
  OVERTIME_HOURS:      8,
  WIFI_REQUIRED:       true,
  OFFLINE_CLOCK_IN:    true,
  LATE_NIGHT_MINOR_BAN: true,
};

/* ---- グローバル状態 ---- */
let appState = {
  currentState: STATES.LOGGED_OUT,
  currentRole:  null,
  loginFailures: 0,
  sessionExpiry: null,
  wifiConnected: true,
  isMinor:       false,
  currentShift:  null,
  workStart:     null,
  breakStart:    null,
  totalBreak:    0,
  overtimeHours: 0,
  isLateNight:   false,
  transitionLog: [],
};

/* ---- デモ用ダミーデータ（50名） ---- */
const DEMO = {
  staff: [
    /* 管理者 (2名) */
    { id:  1, name: '佐藤 健一',   role: ROLES.ADMIN,      state: STATES.SALARY_PENDING,      store: '渋谷店',  age: 42, hourlyRate: null,  clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '全店舗管理担当' },
    { id:  2, name: '高橋 美智子', role: ROLES.ADMIN,      state: STATES.NOTIFY_FAILED,       store: '新宿店',  age: 38, hourlyRate: null,  clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: 'SMTP障害対応中' },

    /* 店長 (4名) */
    { id:  3, name: '山田 太郎',   role: ROLES.MANAGER,    state: STATES.SHIFT_CREATING,      store: '渋谷店',  age: 35, hourlyRate: null,  clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '8月シフト作成中' },
    { id:  4, name: '鈴木 恵子',   role: ROLES.MANAGER,    state: STATES.SHIFT_CONFIRMED,     store: '新宿店',  age: 31, hourlyRate: null,  clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '公開待ち' },
    { id:  5, name: '伊藤 誠',     role: ROLES.MANAGER,    state: STATES.ATTENDANCE_PENDING,  store: '池袋店',  age: 40, hourlyRate: null,  clockIn: '09:55', clockOut: '19:10', breakMin: 60,  overtimeMin: 75, note: '勤怠確認要' },
    { id:  6, name: '渡辺 美香',   role: ROLES.MANAGER,    state: STATES.WORKING,             store: '渋谷店',  age: 29, hourlyRate: null,  clockIn: '13:00', clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '現在シフト指揮中' },

    /* アルバイト (44名) — 全状態を網羅 */
    /* 勤務希望未提出 */
    { id:  7, name: '田中 花子',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '渋谷店',  age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '締切3日前' },
    { id:  8, name: '中村 拓也',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '新宿店',  age: 19, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '初月勤務' },
    { id:  9, name: '小林 さくら', role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '池袋店',  age: 17, hourlyRate: 1050, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '未成年・深夜禁止', isMinor: true },
    { id: 10, name: '加藤 健太',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '渋谷店',  age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '大学生' },
    { id: 11, name: '吉田 あおい', role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_PENDING,   store: '新宿店',  age: 25, hourlyRate: 1200, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '週3希望' },

    /* 勤務希望提出済 */
    { id: 12, name: '山本 勇気',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_SUBMITTED, store: '渋谷店',  age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '提出済み' },
    { id: 13, name: '松本 優',     role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_SUBMITTED, store: '池袋店',  age: 18, hourlyRate: 1050, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '土日中心希望', isMinor: true },
    { id: 14, name: '井上 彩花',   role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_SUBMITTED, store: '新宿店',  age: 23, hourlyRate: 1180, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '平日フル希望' },
    { id: 15, name: '木村 蓮',     role: ROLES.PART_TIME,  state: STATES.SHIFT_REQ_SUBMITTED, store: '渋谷店',  age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: 'シフト確定待ち' },

    /* シフト公開済 */
    { id: 16, name: '林 奈々',     role: ROLES.PART_TIME,  state: STATES.SHIFT_PUBLISHED,     store: '渋谷店',  age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '確認済み' },
    { id: 17, name: '清水 航',     role: ROLES.PART_TIME,  state: STATES.SHIFT_PUBLISHED,     store: '新宿店',  age: 24, hourlyRate: 1200, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: 'シフト確認中' },
    { id: 18, name: '山崎 柚子',   role: ROLES.PART_TIME,  state: STATES.SHIFT_PUBLISHED,     store: '池袋店',  age: 19, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '欠勤検討中' },

    /* 出勤前 */
    { id: 19, name: '森 悠斗',     role: ROLES.PART_TIME,  state: STATES.PRE_WORK,            store: '渋谷店',  age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '14:00出勤予定' },
    { id: 20, name: '池田 莉子',   role: ROLES.PART_TIME,  state: STATES.PRE_WORK,            store: '新宿店',  age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '10:00出勤予定' },
    { id: 21, name: '橋本 颯太',   role: ROLES.PART_TIME,  state: STATES.PRE_WORK,            store: '渋谷店',  age: 18, hourlyRate: 1050, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: 'Wi-Fi未接続注意', isMinor: true },

    /* 出勤中 */
    { id: 22, name: '阿部 千夏',   role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '渋谷店',  age: 23, hourlyRate: 1180, clockIn: '09:58', clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '朝番' },
    { id: 23, name: '石川 大翔',   role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '新宿店',  age: 25, hourlyRate: 1200, clockIn: '10:03', clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '勤務3時間経過' },
    { id: 24, name: '前田 みずき', role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '池袋店',  age: 22, hourlyRate: 1150, clockIn: '13:01', clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '昼番' },
    { id: 25, name: '藤田 蒼',     role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '渋谷店',  age: 20, hourlyRate: 1150, clockIn: '17:00', clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '夕方番' },
    { id: 26, name: '岡田 里奈',   role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '新宿店',  age: 19, hourlyRate: 1100, clockIn: '18:00', clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '深夜シフト開始前' },
    { id: 27, name: '後藤 翔平',   role: ROLES.PART_TIME,  state: STATES.WORKING,             store: '渋谷店',  age: 26, hourlyRate: 1250, clockIn: '08:00', clockOut: null,    breakMin: 60,  overtimeMin: 0,  note: '8時間超え間近！' },

    /* 休憩中 */
    { id: 28, name: '長谷川 葵',   role: ROLES.PART_TIME,  state: STATES.ON_BREAK,            store: '渋谷店',  age: 21, hourlyRate: 1150, clockIn: '10:00', clockOut: null,    breakMin: 25,  overtimeMin: 0,  note: '休憩中（残5分）' },
    { id: 29, name: '村田 晴菜',   role: ROLES.PART_TIME,  state: STATES.ON_BREAK,            store: '池袋店',  age: 20, hourlyRate: 1100, clockIn: '13:00', clockOut: null,    breakMin: 10,  overtimeMin: 0,  note: '休憩開始直後' },
    { id: 30, name: '近藤 朔',     role: ROLES.PART_TIME,  state: STATES.ON_BREAK,            store: '新宿店',  age: 24, hourlyRate: 1200, clockIn: '11:00', clockOut: null,    breakMin: 45,  overtimeMin: 0,  note: '長めの休憩' },

    /* 残業申請中 */
    { id: 31, name: '藤井 結月',   role: ROLES.PART_TIME,  state: STATES.OVERTIME_APPLYING,   store: '渋谷店',  age: 22, hourlyRate: 1150, clockIn: '10:00', clockOut: null,    breakMin: 60,  overtimeMin: 90, note: '繁忙期で+1.5h申請' },
    { id: 32, name: '西村 拓海',   role: ROLES.PART_TIME,  state: STATES.OVERTIME_APPLYING,   store: '新宿店',  age: 28, hourlyRate: 1300, clockIn: '09:00', clockOut: null,    breakMin: 60,  overtimeMin: 120,note: '在庫整理+2h申請' },

    /* 欠勤申請中 */
    { id: 33, name: '福田 ひより', role: ROLES.PART_TIME,  state: STATES.ABSENCE_APPLYING,    store: '渋谷店',  age: 20, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '体調不良' },
    { id: 34, name: '岡本 亮',     role: ROLES.PART_TIME,  state: STATES.ABSENCE_APPLYING,    store: '池袋店',  age: 23, hourlyRate: 1180, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '家族の緊急事態' },
    { id: 35, name: '遠藤 菜々美', role: ROLES.PART_TIME,  state: STATES.ABSENCE_APPLYING,    store: '新宿店',  age: 19, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '試験と重複' },

    /* 代替募集中 */
    { id: 36, name: '青木 陸',     role: ROLES.PART_TIME,  state: STATES.REPLACEMENT_OPEN,    store: '渋谷店',  age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '8/1代替募集中' },
    { id: 37, name: '竹内 ゆか',   role: ROLES.PART_TIME,  state: STATES.REPLACEMENT_OPEN,    store: '池袋店',  age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '8/3代替募集中' },

    /* 勤怠未確定 */
    { id: 38, name: '金子 海斗',   role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '渋谷店',  age: 24, hourlyRate: 1200, clockIn: '10:00', clockOut: '18:08', breakMin: 60,  overtimeMin: 0,  note: '確認待ち' },
    { id: 39, name: '工藤 美羽',   role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '新宿店',  age: 20, hourlyRate: 1150, clockIn: '13:02', clockOut: '21:15', breakMin: 60,  overtimeMin: 0,  note: '退勤時刻要確認' },
    { id: 40, name: '和田 一輝',   role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '池袋店',  age: 22, hourlyRate: 1150, clockIn: '09:55', clockOut: '18:30', breakMin: 60,  overtimeMin: 30, note: '残業あり' },
    { id: 41, name: '斎藤 えみか', role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '渋谷店',  age: 21, hourlyRate: 1150, clockIn: '17:00', clockOut: '23:05', breakMin: 45,  overtimeMin: 0,  note: '深夜帯含む' },
    { id: 42, name: '横山 蓮太',   role: ROLES.PART_TIME,  state: STATES.ATTENDANCE_PENDING,  store: '新宿店',  age: 25, hourlyRate: 1250, clockIn: '08:30', clockOut: '17:00', breakMin: 60,  overtimeMin: 0,  note: '打刻正常' },

    /* 給与未計算 */
    { id: 43, name: '内田 朱音',   role: ROLES.PART_TIME,  state: STATES.SALARY_PENDING,      store: '渋谷店',  age: 23, hourlyRate: 1180, clockIn: '10:00', clockOut: '18:00', breakMin: 60,  overtimeMin: 0,  note: '7月分確定済み' },
    { id: 44, name: '宮崎 大空',   role: ROLES.PART_TIME,  state: STATES.SALARY_PENDING,      store: '池袋店',  age: 20, hourlyRate: 1150, clockIn: '13:00', clockOut: '21:00', breakMin: 60,  overtimeMin: 0,  note: '7月分確定済み' },
    { id: 45, name: '田村 葉月',   role: ROLES.PART_TIME,  state: STATES.SALARY_PENDING,      store: '新宿店',  age: 19, hourlyRate: 1100, clockIn: '09:00', clockOut: '17:00', breakMin: 60,  overtimeMin: 0,  note: '7月分確定済み' },
    { id: 46, name: '原田 悠真',   role: ROLES.PART_TIME,  state: STATES.SALARY_PENDING,      store: '渋谷店',  age: 26, hourlyRate: 1300, clockIn: '10:00', clockOut: '19:30', breakMin: 60,  overtimeMin: 90, note: '残業込み計算要' },

    /* 通知送信失敗（アルバイトへの通知が失敗しているケース） */
    { id: 47, name: '松田 柊',     role: ROLES.PART_TIME,  state: STATES.NOTIFY_FAILED,       store: '渋谷店',  age: 22, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: 'シフト公開通知失敗' },
    { id: 48, name: '石田 あかり', role: ROLES.PART_TIME,  state: STATES.NOTIFY_FAILED,       store: '新宿店',  age: 21, hourlyRate: 1150, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '欠勤承認通知失敗' },

    /* 未ログイン（新規・長期休暇明け） */
    { id: 49, name: '三浦 朝陽',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,          store: '池袋店',  age: 20, hourlyRate: 1100, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '新規スタッフ' },
    { id: 50, name: '坂本 ひな',   role: ROLES.PART_TIME,  state: STATES.LOGGED_OUT,          store: '渋谷店',  age: 23, hourlyRate: 1180, clockIn: null,    clockOut: null,    breakMin: 0,   overtimeMin: 0,  note: '産休明け復帰予定' },
  ],
  shiftRequests: [
    { staffId:  7, date: '2025-08-01', start: '10:00', end: '18:00' },
    { staffId:  7, date: '2025-08-03', start: '13:00', end: '21:00' },
    { staffId: 12, date: '2025-08-02', start: '10:00', end: '18:00' },
    { staffId: 12, date: '2025-08-04', start: '13:00', end: '21:00' },
    { staffId: 13, date: '2025-08-01', start: '10:00', end: '16:00' },
    { staffId: 14, date: '2025-08-02', start: '09:00', end: '17:00' },
    { staffId: 15, date: '2025-08-03', start: '11:00', end: '19:00' },
  ],
  currentShift: { date: '本日', start: '10:00', end: '18:00', store: '渋谷店' },
  attendance:   { clockIn: '10:02', clockOut: null, breakMin: 60, overtime: 0 },
};

/* ============================================================
   状態機械 — transition()
   ============================================================ */
function transition(eventName, payload = {}) {
  const route = EVENT_ROUTES[eventName];
  if (!route) {
    logTransition(eventName, 'ERROR: event_routesに存在しないイベント');
    return false;
  }
  if (!route.from.includes(appState.currentState)) {
    logTransition(eventName, `ERROR: ${appState.currentState}からこのイベントは発火不可`);
    return false;
  }
  if (appState.currentRole && !route.roles.includes(appState.currentRole)) {
    logTransition(eventName, 'ERROR: 権限外イベント');
    return false;
  }

  const prevState = appState.currentState;

  /* 個別処理 */
  switch (eventName) {
    case 'LOGIN':
      if (!processLogin(payload)) return false;
      break;
    case 'CLOCK_IN':
      if (!processClockin(payload)) return false;
      break;
    case 'BREAK_START':
      appState.breakStart = new Date();
      break;
    case 'BREAK_END':
      if (appState.breakStart) {
        appState.totalBreak += Math.round((new Date() - appState.breakStart) / 60000);
        appState.breakStart = null;
      }
      break;
    case 'CLOCK_OUT':
      appState.attendance = { ...DEMO.attendance, clockOut: new Date().toTimeString().slice(0,5) };
      break;
    case 'ATTENDANCE_CONFIRM':
      appState.attendanceConfirmed = true;
      break;
    case 'SALARY_CALC':
      appState.salaryCalculated = true;
      break;
  }

  appState.currentState = route.to;
  logTransition(eventName, `${prevState} → ${route.to}`, payload);
  updateGuideOnStateChange();
  return true;
}

function processLogin({ role, email, password }) {
  if (appState.loginFailures >= RULES.MAX_LOGIN_FAILURES) {
    showError('アカウントがロックされています。管理者にご連絡ください。');
    return false;
  }
  if (!email || !password) {
    appState.loginFailures++;
    showError(`メールアドレスとパスワードを入力してください（失敗${appState.loginFailures}/${RULES.MAX_LOGIN_FAILURES}回）`);
    return false;
  }
  appState.currentRole = role || ROLES.PART_TIME;
  appState.loginFailures = 0;
  appState.sessionExpiry = new Date(Date.now() + RULES.SESSION_HOURS * 3600000);
  return true;
}

function processClockin() {
  if (RULES.WIFI_REQUIRED && !appState.wifiConnected && !RULES.OFFLINE_CLOCK_IN) {
    showError('店舗Wi-Fiに接続されていません。打刻できません。');
    return false;
  }
  if (appState.isMinor && appState.isLateNight) {
    showError('18歳未満の深夜勤務は禁止されています。');
    return false;
  }
  appState.workStart = new Date();
  return true;
}

/* ---- 遷移ログ ---- */
function logTransition(event, message, payload = {}) {
  const entry = {
    timestamp: new Date().toLocaleTimeString('ja-JP'),
    event,
    message,
    state: appState.currentState,
  };
  appState.transitionLog.unshift(entry);
  if (appState.transitionLog.length > 50) appState.transitionLog.pop();
  renderTransitionLog();
}

/* ============================================================
   UI誘導エンジン
   ============================================================ */

/* ---- 状態進行モデル (線形) ---- */
const STATE_PROGRESS_MODEL = [
  { state: STATES.LOGGED_OUT,          label: 'ログイン',      icon: 'ti-login' },
  { state: STATES.SHIFT_REQ_PENDING,   label: '勤務希望提出',  icon: 'ti-calendar-event' },
  { state: STATES.SHIFT_REQ_SUBMITTED, label: '希望提出済',    icon: 'ti-calendar-check' },
  { state: STATES.SHIFT_CREATING,      label: 'シフト作成',    icon: 'ti-layout-grid' },
  { state: STATES.SHIFT_CONFIRMED,     label: 'シフト確定',    icon: 'ti-circle-check' },
  { state: STATES.SHIFT_PUBLISHED,     label: 'シフト公開',    icon: 'ti-eye' },
  { state: STATES.PRE_WORK,            label: '出勤前',        icon: 'ti-clock' },
  { state: STATES.WORKING,             label: '出勤中',        icon: 'ti-briefcase' },
  { state: STATES.ON_BREAK,            label: '休憩中',        icon: 'ti-coffee' },
  { state: STATES.ATTENDANCE_PENDING,  label: '勤怠確認',      icon: 'ti-clipboard-check' },
  { state: STATES.SALARY_PENDING,      label: '給与計算',      icon: 'ti-coin' },
];

function getCurrentProgress() {
  const idx = STATE_PROGRESS_MODEL.findIndex(s => s.state === appState.currentState);
  return {
    current: idx,
    total:   STATE_PROGRESS_MODEL.length,
    pct:     idx < 0 ? 0 : Math.round((idx / (STATE_PROGRESS_MODEL.length - 1)) * 100),
    steps:   STATE_PROGRESS_MODEL,
  };
}

function getNextAction() {
  const guides = {
    [STATES.LOGGED_OUT]: {
      cta:    'ログインしてください',
      action: 'メールアドレスとパスワードを入力してログイン',
      event:  'LOGIN',
      warn:   null,
    },
    [STATES.SHIFT_REQ_PENDING]: {
      cta:    '勤務希望を提出してください',
      action: '希望日・時間帯を選択して提出',
      event:  'SHIFT_REQUEST_SUBMIT',
      warn:   '締切後は編集できません',
    },
    [STATES.SHIFT_REQ_SUBMITTED]: {
      cta:    'シフト確定をお待ちください',
      action: '店長がシフトを作成中です',
      event:  null,
      warn:   null,
    },
    [STATES.SHIFT_CREATING]: {
      cta:    '不足時間帯を確認してください',
      action: 'スタッフを割り当てて不足を解消',
      event:  'SHIFT_CONFIRM',
      warn:   null,
    },
    [STATES.SHIFT_CONFIRMED]: {
      cta:    'シフトを公開してください',
      action: '内容を確認の上、スタッフに公開',
      event:  'SHIFT_PUBLISH',
      warn:   null,
    },
    [STATES.SHIFT_PUBLISHED]: {
      cta:    '勤務内容を確認してください',
      action: '確定シフトを確認。欠勤の場合は申請',
      event:  'ABSENCE_APPLY',
      warn:   null,
    },
    [STATES.PRE_WORK]: {
      cta:    '出勤打刻してください',
      action: '出勤ボタンを押して打刻',
      event:  'CLOCK_IN',
      warn:   appState.wifiConnected ? null : '店舗Wi-Fi未接続',
    },
    [STATES.WORKING]: {
      cta:    '勤務中です',
      action: '休憩または退勤を操作してください',
      event:  null,
      warn:   appState.overtimeHours > 8 ? '残業未申請で8時間超過しています' : null,
    },
    [STATES.ON_BREAK]: {
      cta:    '休憩終了してください',
      action: '休憩終了ボタンを押してください',
      event:  'BREAK_END',
      warn:   null,
    },
    [STATES.OVERTIME_APPLYING]: {
      cta:    '残業申請を送信してください',
      action: '残業理由を入力して申請',
      event:  'OVERTIME_APPLY',
      warn:   null,
    },
    [STATES.ABSENCE_APPLYING]: {
      cta:    '欠勤申請を完了してください',
      action: '欠勤理由を入力して送信',
      event:  'ABSENCE_APPLY',
      warn:   null,
    },
    [STATES.REPLACEMENT_OPEN]: {
      cta:    '代替勤務へ応募してください',
      action: '応募ボタンを押して申し込み',
      event:  'REPLACEMENT_APPLY',
      warn:   null,
    },
    [STATES.ATTENDANCE_PENDING]: {
      cta:    '勤怠を確認してください',
      action: '出退勤時刻を確認・修正し確定',
      event:  'ATTENDANCE_CONFIRM',
      warn:   null,
    },
    [STATES.SALARY_PENDING]: {
      cta:    '給与計算を実行してください',
      action: '確定済み勤怠をもとに給与計算',
      event:  'SALARY_CALC',
      warn:   null,
    },
    [STATES.NOTIFY_FAILED]: {
      cta:    '通知を再送してください',
      action: '失敗した通知を手動再送',
      event:  'NOTIFY_RETRY',
      warn:   '通知送信に失敗しています',
    },
  };
  return guides[appState.currentState] || { cta: 'Undefined', action: 'Undefined', event: null, warn: null };
}

/* ============================================================
   レンダリング
   ============================================================ */

function renderGuide() {
  const guide    = getNextAction();
  const progress = getCurrentProgress();
  const guideBox = document.getElementById('guide-box');
  if (!guideBox) return;

  const warnHtml = guide.warn
    ? `<div class="warn-box"><i class="ti ti-alert-triangle"></i> ${guide.warn}</div>`
    : '';

  guideBox.innerHTML = `
    <div class="guide-cta">${guide.cta}</div>
    <div class="guide-action"><i class="ti ti-arrow-right"></i> ${guide.action}</div>
    ${warnHtml}
    <div class="guide-progress-bar">
      <div class="guide-progress-fill" style="width:${progress.pct}%"></div>
    </div>
    <div class="guide-progress-label">進捗 ${progress.pct}%（${STATE_PROGRESS_MODEL.findIndex(s=>s.state===appState.currentState)+1} / ${STATE_PROGRESS_MODEL.length} ステップ）</div>
  `;
}

function renderProgressStepper() {
  const progress = getCurrentProgress();
  const container = document.getElementById('progress-stepper');
  if (!container) return;

  const stepsHtml = STATE_PROGRESS_MODEL.map((step, idx) => {
    const isActive   = step.state === appState.currentState;
    const isDone     = idx < progress.current;
    const cls = isActive ? 'step active' : isDone ? 'step done' : 'step pending';
    const badge = isDone ? '<span class="step-badge"><i class="ti ti-check"></i></span>' : '';
    return `
      <div class="${cls}" title="${step.label}">
        <div class="step-dot">${badge || `<i class="ti ${step.icon}"></i>`}</div>
        <div class="step-label">${step.label}</div>
      </div>
    `;
  }).join('<div class="step-line"></div>');

  container.innerHTML = stepsHtml;
}

function renderStatePanel() {
  const panel = document.getElementById('state-panel');
  if (!panel) return;

  const roleLabel = { admin: '管理者', manager: '店長', part_time: 'アルバイト' };
  const role = appState.currentRole ? roleLabel[appState.currentRole] : '—';
  const session = appState.sessionExpiry
    ? `セッション期限 ${appState.sessionExpiry.toLocaleTimeString('ja-JP')}`
    : 'セッションなし';

  panel.innerHTML = `
    <div class="state-current">
      <span class="state-badge">${appState.currentState}</span>
      <span class="state-meta">${role} | ${session}</span>
    </div>
  `;
}

function renderMainView() {
  const main = document.getElementById('main-view');
  if (!main) return;
  main.innerHTML = buildViewForState(appState.currentState);
  bindViewEvents();
}

function highlightNextTarget() {
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('next-target'));
  const tabMap = {
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
  const targetId = tabMap[appState.currentState];
  if (targetId) {
    const el = document.getElementById(targetId);
    if (el) el.classList.add('next-target');
  }
}

function updateGuideOnStateChange() {
  renderProgressStepper();
  renderGuide();
  renderStatePanel();
  renderMainView();
  highlightNextTarget();
  renderStaffList();
}

/* ============================================================
   スタッフ一覧レンダー
   ============================================================ */
const STATE_COLOR = {
  [STATES.LOGGED_OUT]:          { cls: 'sl-gray',   label: '未ログイン' },
  [STATES.SHIFT_REQ_PENDING]:   { cls: 'sl-warn',   label: '希望未提出' },
  [STATES.SHIFT_REQ_SUBMITTED]: { cls: 'sl-info',   label: '希望提出済' },
  [STATES.SHIFT_CREATING]:      { cls: 'sl-purple',  label: 'シフト作成中' },
  [STATES.SHIFT_CONFIRMED]:     { cls: 'sl-purple',  label: 'シフト確定済' },
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

const ROLE_LABEL = { admin: '管理者', manager: '店長', part_time: 'アルバイト' };

let staffFilter = { state: 'all', role: 'all', store: 'all', search: '' };

function renderStaffList() {
  const container = document.getElementById('staff-list-panel');
  if (!container) return;

  /* フィルタ適用 */
  let list = DEMO.staff.filter(s => {
    if (staffFilter.state !== 'all' && s.state !== staffFilter.state) return false;
    if (staffFilter.role  !== 'all' && s.role  !== staffFilter.role)  return false;
    if (staffFilter.store !== 'all' && s.store !== staffFilter.store)  return false;
    if (staffFilter.search) {
      const q = staffFilter.search.toLowerCase();
      if (!s.name.toLowerCase().includes(q) && !s.note.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  /* 状態別集計 */
  const counts = {};
  DEMO.staff.forEach(s => { counts[s.state] = (counts[s.state] || 0) + 1; });
  const working  = (counts[STATES.WORKING]  || 0) + (counts[STATES.ON_BREAK] || 0);
  const alertCnt = (counts[STATES.ABSENCE_APPLYING] || 0) + (counts[STATES.NOTIFY_FAILED] || 0) + (counts[STATES.OVERTIME_APPLYING] || 0) + (counts[STATES.REPLACEMENT_OPEN] || 0);

  /* ユニーク店舗リスト */
  const stores = [...new Set(DEMO.staff.map(s => s.store))].sort();
  const states = [...new Set(DEMO.staff.map(s => s.state))].sort();

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
        ${states.map(s => `<option value="${s}" ${staffFilter.state===s?'selected':''}>${STATE_COLOR[s]?.label||s}</option>`).join('')}
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

    <div class="sl-result-count">${list.length}件表示</div>

    <div class="sl-table">
      <div class="sl-row sl-row-header">
        <span>名前</span>
        <span>ロール</span>
        <span>店舗</span>
        <span>状態</span>
        <span>時給</span>
        <span>打刻</span>
        <span>メモ</span>
      </div>
      ${list.map(s => {
        const sc    = STATE_COLOR[s.state] || { cls: 'sl-gray', label: s.state };
        const clock = s.clockIn ? `${s.clockIn}${s.clockOut ? ' → ' + s.clockOut : ' →'}` : '—';
        const rate  = s.hourlyRate ? `¥${s.hourlyRate}` : '—';
        const minor = s.isMinor ? ' <span class="sl-minor">未成年</span>' : '';
        const ot    = s.overtimeMin > 0 ? ` <span class="sl-ot">残業${s.overtimeMin}分</span>` : '';
        return `
          <div class="sl-row sl-row-body" onclick="jumpToState('${s.state}')" title="${s.name}の状態へジャンプ">
            <span class="sl-name">${s.name}${minor}</span>
            <span class="sl-role">${ROLE_LABEL[s.role]}</span>
            <span class="sl-store">${s.store}</span>
            <span><span class="sl-badge ${sc.cls}">${sc.label}</span>${ot}</span>
            <span class="sl-rate">${rate}</span>
            <span class="sl-clock">${clock}</span>
            <span class="sl-note">${s.note}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* ============================================================
   ビュービルダー — 状態ごとのUI
   ============================================================ */
function buildViewForState(state) {
  switch (state) {

    case STATES.LOGGED_OUT:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-lock"></i> ログイン</h2>
          <p class="view-desc">メールアドレスとパスワードでログインしてください。</p>
          <div class="form-group">
            <label>メールアドレス</label>
            <input type="email" id="inp-email" placeholder="example@store.jp" />
          </div>
          <div class="form-group">
            <label>パスワード</label>
            <input type="password" id="inp-password" placeholder="••••••••" />
          </div>
          <div class="form-group">
            <label>ロール（デモ用）</label>
            <select id="inp-role">
              <option value="${ROLES.PART_TIME}">アルバイト</option>
              <option value="${ROLES.MANAGER}">店長</option>
              <option value="${ROLES.ADMIN}">管理者</option>
            </select>
          </div>
          <div class="error-box" id="login-error" style="display:none"></div>
          <button class="btn-primary" id="btn-login">ログイン</button>
          <button class="btn-ghost" id="btn-pwreset">パスワードリセット</button>
          <p class="hint">セッション有効時間: ${RULES.SESSION_HOURS}時間 | 失敗${RULES.MAX_LOGIN_FAILURES}回でロック</p>
        </div>`;

    case STATES.SHIFT_REQ_PENDING:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-calendar-event"></i> 勤務希望提出</h2>
          <div class="info-row"><span class="info-label">対象月</span><span>2025年8月</span></div>
          <div class="info-row"><span class="info-label">締切日</span><span class="warn-text">2025年7月25日</span></div>
          <div class="info-row"><span class="info-label">提出状況</span><span class="badge-warn">未提出</span></div>
          <div class="form-group">
            <label>希望日</label>
            <input type="date" id="inp-shift-date" value="2025-08-01" />
          </div>
          <div class="form-group">
            <label>開始時間</label>
            <input type="time" id="inp-shift-start" value="10:00" />
          </div>
          <div class="form-group">
            <label>終了時間</label>
            <input type="time" id="inp-shift-end" value="18:00" />
          </div>
          <button class="btn-secondary" id="btn-shift-save">一時保存</button>
          <button class="btn-primary" id="btn-shift-submit">提出する</button>
          <p class="hint">⚠ 締切後は編集できません</p>
        </div>`;

    case STATES.SHIFT_REQ_SUBMITTED:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-calendar-check"></i> 勤務希望提出済</h2>
          <div class="badge-success-lg">✓ 提出完了</div>
          <div class="info-row"><span class="info-label">提出日時</span><span>${new Date().toLocaleString('ja-JP')}</span></div>
          <div class="info-row"><span class="info-label">次のステップ</span><span>シフト確定待ち</span></div>
          <p class="hint">店長がシフトを作成中です。公開後にお知らせします。</p>
        </div>`;

    case STATES.SHIFT_CREATING:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-layout-grid"></i> シフト作成（店長）</h2>
          <div class="info-grid">
            <div class="info-card"><div class="info-num">12</div><div>提出済みスタッフ</div></div>
            <div class="info-card warn"><div class="info-num">3</div><div>不足時間帯</div></div>
          </div>
          <div class="shift-table">
            <div class="shift-row header"><span>日付</span><span>スタッフ</span><span>時間</span><span>状態</span></div>
            <div class="shift-row"><span>8/1(月)</span><span>田中 花子</span><span>10:00〜18:00</span><span class="badge-ok">割当済</span></div>
            <div class="shift-row"><span>8/2(火)</span><span>—</span><span>13:00〜21:00</span><span class="badge-warn">未割当</span></div>
          </div>
          <button class="btn-secondary" id="btn-shift-draft">シフト保存</button>
          <button class="btn-primary" id="btn-shift-confirm">シフト確定</button>
        </div>`;

    case STATES.SHIFT_CONFIRMED:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-circle-check"></i> シフト確定済</h2>
          <div class="badge-success-lg">✓ シフト確定完了</div>
          <p class="view-desc">スタッフへ公開することで全員が確認できるようになります。</p>
          <button class="btn-primary" id="btn-shift-publish">スタッフへ公開</button>
          <p class="hint">Undefined: 公開前の最終確認フロー詳細</p>
        </div>`;

    case STATES.SHIFT_PUBLISHED:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-eye"></i> 確定シフト確認</h2>
          <div class="shift-table">
            <div class="shift-row header"><span>日付</span><span>時間</span><span>店舗</span></div>
            <div class="shift-row"><span>8/1(月)</span><span>10:00〜18:00</span><span>渋谷店</span></div>
            <div class="shift-row"><span>8/3(水)</span><span>13:00〜21:00</span><span>渋谷店</span></div>
          </div>
          <button class="btn-warn" id="btn-absence-apply">欠勤申請</button>
        </div>`;

    case STATES.PRE_WORK:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-clock"></i> 出勤前</h2>
          <div class="info-row"><span class="info-label">本日のシフト</span><span>${DEMO.currentShift.store} ${DEMO.currentShift.start}〜${DEMO.currentShift.end}</span></div>
          <div class="info-row"><span class="info-label">Wi-Fi接続</span>
            <span id="wifi-status" class="${appState.wifiConnected ? 'badge-ok' : 'badge-error'}">
              ${appState.wifiConnected ? '接続中' : '未接続'}
            </span>
          </div>
          <label class="toggle-row">
            <input type="checkbox" id="chk-wifi" ${appState.wifiConnected ? 'checked' : ''} />
            <span>Wi-Fiシミュレート（デモ用）</span>
          </label>
          ${!appState.wifiConnected ? '<div class="warn-box">店舗Wi-Fi未接続 — オフライン打刻は後で同期されます</div>' : ''}
          <button class="btn-primary btn-xl" id="btn-clock-in">🕐 出勤打刻</button>
        </div>`;

    case STATES.WORKING: {
      const elapsed = appState.workStart
        ? Math.round((Date.now() - appState.workStart.getTime()) / 60000)
        : 0;
      const h = Math.floor(elapsed/60), m = elapsed%60;
      const overtimeWarn = elapsed > RULES.OVERTIME_HOURS * 60
        ? '<div class="warn-box"><i class="ti ti-alert-triangle"></i> 8時間超過 — 残業申請が必要です</div>'
        : '';
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-briefcase"></i> 出勤中</h2>
          <div class="time-display">${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')} <span class="time-unit">経過</span></div>
          <div class="info-row"><span class="info-label">深夜判定</span><span>${appState.isLateNight ? '深夜帯（×1.25）' : '通常時間帯'}</span></div>
          <div class="info-row"><span class="info-label">休憩累計</span><span>${appState.totalBreak}分</span></div>
          ${overtimeWarn}
          <div class="btn-row">
            <button class="btn-secondary" id="btn-break-start">休憩開始</button>
            <button class="btn-primary" id="btn-clock-out">退勤打刻</button>
          </div>
          <button class="btn-ghost" id="btn-overtime-apply">残業申請</button>
        </div>`;
    }

    case STATES.ON_BREAK: {
      const breakElapsed = appState.breakStart
        ? Math.round((Date.now() - appState.breakStart.getTime()) / 60000)
        : 0;
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-coffee"></i> 休憩中</h2>
          <div class="time-display">${breakElapsed} <span class="time-unit">分経過</span></div>
          <div class="info-row"><span class="info-label">休憩開始</span><span>${appState.breakStart ? appState.breakStart.toLocaleTimeString('ja-JP') : '—'}</span></div>
          <button class="btn-primary btn-xl" id="btn-break-end">休憩終了</button>
        </div>`;
    }

    case STATES.ABSENCE_APPLYING:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-calendar-x"></i> 欠勤申請</h2>
          <div class="info-row"><span class="info-label">対象シフト</span><span>8/1(月) 10:00〜18:00</span></div>
          <div class="info-row"><span class="info-label">承認状態</span><span class="badge-warn">申請中</span></div>
          <div class="form-group">
            <label>欠勤理由</label>
            <textarea id="inp-absence-reason" rows="3" placeholder="理由を入力してください"></textarea>
          </div>
          <button class="btn-primary" id="btn-absence-send">欠勤申請を送信</button>
        </div>`;

    case STATES.REPLACEMENT_OPEN:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-repeat"></i> 代替募集</h2>
          <div class="info-row"><span class="info-label">募集シフト</span><span>8/1(月) 10:00〜18:00</span></div>
          <div class="info-row"><span class="info-label">締切</span><span class="warn-text">7/31 23:59</span></div>
          <div class="info-row"><span class="info-label">時給</span><span>¥1,100（深夜割増なし）</span></div>
          <button class="btn-primary" id="btn-replacement-apply">代替応募する</button>
        </div>`;

    case STATES.OVERTIME_APPLYING:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-clock-plus"></i> 残業申請</h2>
          <div class="info-row"><span class="info-label">予定終了時刻</span><span>18:00</span></div>
          <div class="info-row"><span class="info-label">承認状態</span><span class="badge-warn">未承認</span></div>
          <div class="form-group">
            <label>残業理由</label>
            <textarea id="inp-overtime-reason" rows="3" placeholder="残業が必要な理由を入力"></textarea>
          </div>
          <button class="btn-primary" id="btn-overtime-send">残業申請する</button>
          <p class="hint">残業は事前申請制です（業務ルール）</p>
        </div>`;

    case STATES.ATTENDANCE_PENDING:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-clipboard-check"></i> 勤怠確認</h2>
          <div class="info-row"><span class="info-label">出勤時刻</span><span>10:02</span></div>
          <div class="info-row"><span class="info-label">退勤時刻</span><span>${appState.attendance?.clockOut || '18:05'}</span></div>
          <div class="info-row"><span class="info-label">休憩時間</span><span>${appState.totalBreak || 60}分</span></div>
          <div class="info-row"><span class="info-label">深夜時間</span><span>0分</span></div>
          <div class="info-row"><span class="info-label">残業時間</span><span>0分</span></div>
          <div class="info-row"><span class="info-label">実働時間</span><span>7時間3分</span></div>
          <div class="btn-row">
            <button class="btn-secondary" id="btn-attendance-fix">打刻修正</button>
            <button class="btn-primary" id="btn-attendance-confirm">勤怠確定</button>
          </div>
          <p class="hint">Undefined: 打刻改ざん対策</p>
        </div>`;

    case STATES.SALARY_PENDING:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-coin"></i> 給与計算</h2>
          <div class="info-row"><span class="info-label">対象月</span><span>2025年8月</span></div>
          <div class="info-row"><span class="info-label">確定済勤怠数</span><span>8件</span></div>
          <div class="info-row"><span class="info-label">深夜割増</span><span>×${RULES.LATE_NIGHT_BONUS}</span></div>
          <div class="info-row"><span class="info-label">法定休日割増</span><span>×${RULES.HOLIDAY_BONUS}</span></div>
          <button class="btn-primary" id="btn-salary-calc">給与計算を実行</button>
          <p class="hint">CSV出力は管理者のみ | Undefined: CSV項目定義</p>
        </div>`;

    case STATES.NOTIFY_FAILED:
      return `
        <div class="view-card">
          <h2 class="view-title"><i class="ti ti-bell-x"></i> 通知送信失敗</h2>
          <div class="warn-box">通知送信に失敗しています。再送してください。</div>
          <div class="info-row"><span class="info-label">失敗件数</span><span class="badge-error">3件</span></div>
          <div class="info-row"><span class="info-label">再送回数</span><span>2回</span></div>
          <div class="info-row"><span class="info-label">最終エラー</span><span>SMTP接続タイムアウト</span></div>
          <button class="btn-primary" id="btn-notify-retry">通知を手動再送</button>
          <p class="hint">Undefined: 通知テンプレ編集</p>
        </div>`;

    default:
      return `<div class="view-card"><p class="hint">Undefined: このロールまたは状態のUIは未定義です（${state}）</p></div>`;
  }
}

/* ============================================================
   イベントバインド
   ============================================================ */
function bindViewEvents() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };

  on('btn-login', 'click', () => {
    const email    = document.getElementById('inp-email')?.value;
    const password = document.getElementById('inp-password')?.value;
    const role     = document.getElementById('inp-role')?.value;
    const ok = transition('LOGIN', { email, password, role });
    if (!ok) {
      const errEl = document.getElementById('login-error');
      if (errEl) { errEl.style.display = 'block'; errEl.textContent = '認証に失敗しました'; }
    }
  });

  on('btn-pwreset', 'click', () => {
    transition('PASSWORD_RESET', {});
    alert('パスワードリセットメールを送信しました。（デモ）');
  });

  on('btn-shift-submit', 'click', () => transition('SHIFT_REQUEST_SUBMIT'));
  on('btn-shift-save',   'click', () => { alert('一時保存しました。（デモ）'); });
  on('btn-shift-confirm','click', () => transition('SHIFT_CONFIRM'));
  on('btn-shift-draft',  'click', () => { transition('SHIFT_SAVE'); alert('シフトを保存しました。（デモ）'); });
  on('btn-shift-publish','click', () => transition('SHIFT_PUBLISH'));
  on('btn-absence-apply','click', () => transition('ABSENCE_APPLY'));
  on('btn-absence-send', 'click', () => { alert('欠勤申請を送信しました。（デモ）'); });

  on('chk-wifi', 'change', (e) => {
    appState.wifiConnected = e.target.checked;
    updateGuideOnStateChange();
  });

  on('btn-clock-in',  'click', () => transition('CLOCK_IN'));
  on('btn-break-start','click', () => transition('BREAK_START'));
  on('btn-break-end',  'click', () => transition('BREAK_END'));
  on('btn-clock-out',  'click', () => transition('CLOCK_OUT'));

  on('btn-overtime-apply', 'click', () => {
    appState.currentState = STATES.OVERTIME_APPLYING;
    updateGuideOnStateChange();
  });
  on('btn-overtime-send', 'click', () => transition('OVERTIME_APPLY'));

  on('btn-attendance-fix',    'click', () => { transition('ATTENDANCE_FIX'); alert('打刻修正モード（Undefined: 具体的な修正UI）'); });
  on('btn-attendance-confirm','click', () => transition('ATTENDANCE_CONFIRM'));

  on('btn-salary-calc',      'click', () => { transition('SALARY_CALC'); alert('給与計算を実行しました。（デモ）'); });
  on('btn-notify-retry',     'click', () => { transition('NOTIFY_RETRY'); alert('通知を再送しました。（デモ）'); });
  on('btn-replacement-apply','click', () => { transition('REPLACEMENT_APPLY'); alert('代替応募しました。（デモ）'); });
}

/* ---- エラー表示 ---- */
function showError(msg) {
  const el = document.getElementById('global-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/* ---- 遷移ログレンダー ---- */
function renderTransitionLog() {
  const logEl = document.getElementById('transition-log');
  if (!logEl) return;
  logEl.innerHTML = appState.transitionLog.slice(0,20).map(entry => `
    <div class="log-entry">
      <span class="log-time">${entry.timestamp}</span>
      <span class="log-event">${entry.event}</span>
      <span class="log-msg">${entry.message}</span>
    </div>
  `).join('');
}

/* ---- デモ状態ジャンプ ---- */
function jumpToState(state) {
  appState.currentState = state;
  if (state !== STATES.LOGGED_OUT && !appState.currentRole) {
    appState.currentRole = ROLES.PART_TIME;
    appState.sessionExpiry = new Date(Date.now() + 8*3600000);
  }
  if (state === STATES.WORKING && !appState.workStart) {
    appState.workStart = new Date(Date.now() - 3600000);
  }
  logTransition('DEMO_JUMP', `デモジャンプ → ${state}`);
  updateGuideOnStateChange();
}

/* ---- 初期化 ---- */
document.addEventListener('DOMContentLoaded', () => {
  updateGuideOnStateChange();
  renderTransitionLog();
});
