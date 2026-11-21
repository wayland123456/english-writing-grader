/* ============================================================
   rubric.js — 评分标准、词表、内置题库（纯数据）
   ============================================================ */

const RUBRIC = {
  fullMark: 15,
  bands: [
    {
      id: 5, label: '第五档', min: 13, max: 15,
      short: '完全完成任务',
      desc: '完全完成了试题规定的任务。覆盖所有内容要点，表达清楚、合理；使用了较多的复杂结构和高级词汇，即使有少量错误也是为尝试高级表达所致；连接成分运用自然流畅，全文结构紧凑。'
    },
    {
      id: 4, label: '第四档', min: 10, max: 12,
      short: '基本完成任务',
      desc: '基本完成了试题规定的任务。覆盖所有内容要点，表达较为清楚；使用的复杂结构和词汇能满足任务要求，少量错误也是因尝试复杂表达所致；衔接成分使全文结构紧凑。'
    },
    {
      id: 3, label: '第三档', min: 7, max: 9,
      short: '基本完成任务（尚可）',
      desc: '基本完成了试题规定的任务。虽漏掉一些内容要点，但覆盖了主要内容；语法结构和词汇能满足基本要求，句子有一定变化；有一些错误但不影响理解；能用简单的连接词使内容连贯。'
    },
    {
      id: 2, label: '第二档', min: 4, max: 6,
      short: '未适当完成任务',
      desc: '未适当完成试题规定的任务。漏掉或未描述清楚一些内容要点，部分内容与主题无关；语法结构单调，词汇项目有限；有一些错误影响理解；缺少连接成分，内容不连贯。'
    },
    {
      id: 1, label: '第一档', min: 1, max: 3,
      short: '未完成任务',
      desc: '未完成试题规定的任务。明显遗漏主要内容，写了无关内容，偏离主题；语法结构单调，词汇项目极少；有较多错误影响理解，词不达意；缺乏连贯性，信息未能传达给读者。'
    },
    {
      id: 0, label: '0 分', min: 0, max: 0,
      short: '无法评判',
      desc: '未作答；内容太少无法评判；或所写内容与题目要求完全不相关。'
    }
  ],
  // 维度定义（雷达图 / 进度条）
  dims: [
    { key: 'content',   name: '要点覆盖' },
    { key: 'grammar',   name: '语法结构' },
    { key: 'vocab',     name: '词汇丰富' },
    { key: 'coherence', name: '连贯衔接' },
    { key: 'accuracy',  name: '语言准确' },
    { key: 'format',    name: '格式规范' }
  ],
  // 维度权重（决定综合分）
  weights: { content: 0.34, grammar: 0.21, vocab: 0.13, coherence: 0.14, accuracy: 0.12, format: 0.06 },
  // 综合分 → 档位门槛
  thresholds: [
    { band: 5, min: 80 },
    { band: 4, min: 63 },
    { band: 3, min: 47 },
    { band: 2, min: 30 },
    { band: 1, min: 12 }
  ],
  // 硬规则
  rules: {
    wordMin: 60,
    wordMax: 100,
    wordPenalty: 2,
    errorsPerBandDrop: 3,   // 每 3 处低级错误降一档
    maxBandDrop: 2,         // 最多降 2 档
    dropPerBand: 3          // 降一档折算扣分
  }
};

/* ---------------- 连接词分级 ---------------- */
const CONNECTIVES = {
  basic: [
    'and','but','so','or','also','then','because','first','second','third','next',
    'finally','too','as well','at last','now','later','after that','before that'
  ],
  mid: [
    "what's more",'what is more','besides','however','therefore','in addition',
    'on the other hand','as a result','for example','for instance','in fact',
    'instead','moreover','meanwhile','in this way','first of all','above all',
    'in short','so that','even though','in order to','that is to say',
    'to some extent','in my opinion','as for me','as a matter of fact'
  ],
  adv: [
    'nevertheless','consequently','furthermore','in conclusion','to sum up',
    'in summary','first and foremost','last but not least','all in all',
    'as far as i am concerned','as far as i\'m concerned','to be specific',
    'on the whole','in a word','apart from','not only','in the meantime',
    'by contrast','in comparison','to make matters worse','more importantly',
    'most importantly','as a consequence','in the long run'
  ]
};

/* ---------------- 高级句式模式 ---------------- */
const PATTERNS = [
  // ---- 定语从句 ----
  { key: 'attr', label: '定语从句', tier: 'mid', weight: 1,
    re: /\b(which|who|whom|whose)\s+[a-zA-Z]/gi },
  { key: 'attr2', label: '定语从句(that)', tier: 'mid', weight: 0.8,
    re: /\b(?:the|a|an|this|these|those)\s+[a-zA-Z]+(?:s|er|tion|ment|ing|ity)?\s+that\s+(?:is|are|was|were|has|have|had|can|could|will|would|should|helps|makes|gives|brings|allows|enables)\b/gi },

  // ---- 状语从句 ----
  { key: 'advcl', label: '状语从句', tier: 'mid', weight: 1,
    re: /\b(although|though|even though|because|since|as long as|unless|whereas|so that|in order that|no matter how|no matter what|whatever|whenever|wherever|while|when|if|once|until|as soon as)\s+[a-zA-Z]/gi },

  // ---- 名词性从句 ----
  { key: 'nouncl', label: '名词性从句', tier: 'high', weight: 1.4,
    re: /\b(?:what|whether|that|why|how|who)\s+(?:is|are|was|were|matters|counts|impresses|helps|makes|i|we|you|he|she|they)\b/gi },
  { key: 'nouncl_obj', label: '宾语从句', tier: 'high', weight: 1.5,
    re: /\b(?:said|told|think|thought|believe|believed|know|knew|hope|hoped|find|found|realize|realise|remember|remind|notice|wonder|explain|explained|agree|promise|admit|decide|decided)\b[^.!?]{0,28}\b(?:that|whether)\s+[a-zA-Z]+/gi },
  { key: 'nouncl2', label: '主语从句', tier: 'high', weight: 1.6,
    re: /\b(?:What\s+(?:impresses|strikes|attracts|matters|counts|makes|I\s+(?:like|enjoy|value|want))[^.!?]{0,50})/gi },

  // ---- 非谓语 ----
  { key: 'participle_front', label: '分词作状语', tier: 'high', weight: 1.8,
    re: /(?:^|[.!?]\s+|\n\s*)([A-Z][a-z]+(?:ing|ed))\b[^.!?]{0,70},/g },
  { key: 'participle_post', label: '分词作后置定语/状语', tier: 'high', weight: 1.6,
    re: /,\s*(?:making|giving|helping|allowing|enabling|leading|bringing|showing|providing|creating|offering|leaving)\b/gi },
  { key: 'infinitive_adv', label: '不定式作目的状语', tier: 'mid', weight: 1,
    re: /\b(?:in order to|so as to)\s+[a-zA-Z]/gi },

  // ---- 倒装 ----
  { key: 'inversion', label: '倒装句', tier: 'high', weight: 2.2,
    re: /(?:^|[.!?;]\s+|\n\s*)(?:Only|Never|Seldom|Rarely|Hardly|Little|Not until)\b[^.!?]{0,60}\b(?:do|does|did|have|has|had|can|could|will|would|am|is|are|was|were|should)\b/gi },
  { key: 'notonly', label: 'not only 部分倒装', tier: 'high', weight: 2.2,
    re: /\bNot only\s+(?:do|does|did|have|has|had|can|could|will|would|is|are|was|were|should)\b/gi },
  { key: 'sothat_inv', label: 'so/such 倒装', tier: 'high', weight: 2.0,
    re: /\b(?:So|Such)\s+\w+[^.!?]{0,40}\b(?:is|are|was|were|do|does|did|has|have|had)\s+(?:it|he|she|they|we|I)\b/gi },

  // ---- 强调句 ----
  { key: 'cleft', label: '强调句型', tier: 'high', weight: 2.0,
    re: /\bIt\s+(?:is|was)\s+(?:not\s+)?[^.!?]{0,50}\bthat\s+[a-zA-Z]/gi },

  // ---- 被动语态 ----
  { key: 'passive', label: '被动语态', tier: 'mid', weight: 1,
    re: /\b(?:is|are|was|were|be|been|being)\s+(?:\w+ed|done|made|given|taken|seen|known|used|held|sent|told|brought|written|spoken|built|found|shown)\b/gi },

  // ---- 虚拟语气 ----
  { key: 'subjunctive', label: '虚拟语气', tier: 'high', weight: 2.0,
    re: /\b(?:(?:would|could|should|might)\s+have\s+\w+(?:ed|en)\b|If\s+\w+\s+were\b|It\s+is\s+(?:high|about)\s+time\b|I\s+wish\b|suggest(?:ed)?\s+that\s+\w+\s+(?:be|should)\b)/gi },

  // ---- 高级分句结构 ----
  { key: 'nonfinite_perfect', label: '完成式分词', tier: 'high', weight: 2.0,
    re: /\bHaving\s+\w+(?:ed|en)\b[^.!?]{0,60},/gi },
  { key: 'absolute', label: '独立主格', tier: 'high', weight: 2.2,
    re: /\b[A-Za-z]+\s+(?:being|having\s+been)\s+[^.!?]{0,40},/gi }
];

/* ---------------- 高级词汇表（高考高分词） ---------------- */
const ADVANCED_WORDS = [
  'abundant','academic','accomplish','accumulate','accurate','achieve','acknowledge','acquire',
  'adapt','adequate','adjust','admire','adopt','advocate','aesthetic','affection','aggressive',
  'alternative','ambitious','analytical','anticipate','anxiety','apparent','appreciate','approach',
  'appropriate','approve','arouse','assess','assign','assist','associate','assume','astonish',
  'attitude','attractive','authority','available','awareness','balance','barrier','beneficial',
  'blessing','brilliant','broaden','burden','campaign','capable','capacity','capture','career',
  'challenge','characteristic','cherish','circumstance','civilization','clarify','classic',
  'collaborate','commitment','communicate','community','compete','complain','complex','concentrate',
  'concept','concern','conclude','conduct','confidence','conflict','confuse','consequence',
  'conservation','considerable','consist','constant','construct','consume','contemporary',
  'content','context','contrast','contribute','convenient','convey','convince','cooperate',
  'creative','critical','crucial','cultivate','curiosity','definite','delicate','demonstrate',
  'depress','derive','deserve','desire','despite','determine','devote','digital','diligent',
  'discover','discrimination','distinguish','distribute','diverse','dominate','dramatic','durable',
  'eager','ease','efficient','elegant','eliminate','embarrass','emerge','emergency','emotion',
  'emphasis','employ','enable','encounter','endeavor','endure','enhance','enthusiasm','envy',
  'equip','essential','establish','estimate','evaluate','eventually','evidence','evolve','exceed',
  'exchange','exhibit','expand','expense','explore','expose','express','extend','extraordinary',
  'facilitate','factor','fascinating','favourable','feature','flexible','focus','forbid','fortune',
  'foundation','frequent','fulfill','fundamental','generate','generous','genuine','gradual',
  'grasp','grateful','guarantee','harmony','hesitate','highlight','identify','illustrate',
  'imagine','immediate','impact','implement','imply','import','impress','improve','independent',
  'indicate','individual','influence','inform','inherit','initial','innocent','innovative',
  'inspire','install','instance','instruct','intense','intention','interact','interpret',
  'interrupt','investigate','involve','isolate','justify','launch','mature','meaningful',
  'mechanism','mental','mention','method','modest','motivate','negative','neglect','nevertheless',
  'notion','objective','obtain','obvious','occasion','occupy','occur','opportunity','oppose',
  'optimistic','organize','original','outstanding','overcome','participate','particular',
  'passion','patient','perceive','perform','permanent','persist','perspective','persuade',
  'phenomenon','pioneer','positive','potential','practical','precious','predict','prefer',
  'prejudice','prepare','present','preserve','pressure','prevent','previous','priority',
  'process','produce','profession','profit','progress','prohibit','promote','prompt',
  'proper','propose','prospect','protect','proud','provide','publish','pursue','puzzle',
  'qualify','quality','quantity','realistic','recognize','recommend','recover','reduce',
  'reflect','reform','refuse','regard','region','register','regret','regular','relate',
  'relax','release','relevant','reliable','relieve','remain','remarkable','remedy','remove',
  'replace','represent','reputation','require','rescue','research','reserve','resist',
  'resource','respect','responsible','restore','restrict','result','retain','reveal',
  'reverse','review','reward','routine','satisfy','scarce','scatter','schedule','scheme',
  'secure','seek','select','sensitive','separate','series','serious','settle','severe',
  'shelter','shortage','significant','similar','simple','sincere','situation','skill',
  'society','solve','source','specific','spirit','splendid','spread','stable','standard',
  'stimulate','strategy','strength','stress','strict','structure','struggle','submit',
  'substance','succeed','sufficient','suggest','suitable','summary','superior','supply',
  'support','suppose','surface','surround','survive','suspect','sustain','symbol','sympathy',
  'talent','target','technique','temporary','tendency','tension','theory','thorough','threaten',
  'tolerate','tradition','transfer','transform','translate','transport','treasure','treatment',
  'tremendous','trend','trial','tribute','triumph','typical','unique','universal','update',
  'upgrade','urgent','utilize','vacant','vague','valuable','variety','various','vast',
  'vehicle','venture','version','victim','violate','violent','virtue','visible','vision',
  'vital','volunteer','vulnerable','wander','warn','wealth','welfare','whatever','whisper',
  'willing','wisdom','withdraw','witness','wonder','worthwhile','yield',
  'horizon','courage','patience','confidence','benefit','meaningful','rewarding','memorable',
  'impressive','vivid','appealing','challenging','superb','magnificent','gorgeous','insight',
  'perspective','initiative','tolerance','empathy','gratitude','generosity','diligence',
  'perseverance','curiosity','creativity','independence','responsibility','cooperation'
];

/* ---------------- 常见拼写错误 ---------------- */
const SPELLING_ERRORS = {
  'recieve':'receive','beleive':'believe','belive':'believe','achive':'achieve','acheive':'achieve',
  'occured':'occurred','occuring':'occurring','begining':'beginning','comming':'coming',
  'writting':'writing','sitting':'sitting','studing':'studying','tryed':'tried','stoped':'stopped',
  'adress':'address','adress':'address','accomodation':'accommodation','accomodate':'accommodate',
  'arguement':'argument','enviroment':'environment','govement':'government','goverment':'government',
  'neccessary':'necessary','necesary':'necessary','untill':'until','tommorow':'tomorrow',
  'tomorow':'tomorrow','yestarday':'yesterday','becuase':'because','becasue':'because',
  'beacuse':'because','beacuse':'because','freind':'friend','freinds':'friends','frined':'friend',
  'happend':'happened','happend':'happened','intresting':'interesting','intersting':'interesting',
  'knowlege':'knowledge','knowledege':'knowledge','libary':'library','libaray':'library',
  'neighbour':'neighbour','oppurtunity':'opportunity','oppotunity':'opportunity',
  'posible':'possible','posibility':'possibility','prefered':'preferred','probaly':'probably',
  'realy':'really','recomend':'recommend','sucess':'success','succesful':'successful',
  'sucessful':'successful','sincerly':'sincerely','sincerelly':'sincerely','teh':'the',
  'thier':'their','wich':'which','withing':'within','wether':'whether','wheather':'weather',
  'writen':'written','writting':'writing','adopt':'adopt','affraid':'afraid','aganist':'against',
  'allways':'always','ammount':'amount','aparent':'apparent','apologise':'apologize',
  'apreciate':'appreciate','appriciate':'appreciate','atmosphere':'atmosphere','basicly':'basically',
  'beautifull':'beautiful','becouse':'because','buisness':'business','calender':'calendar',
  'carrers':'careers','celebration':'celebration','changable':'changeable','collegue':'colleague',
  'comittee':'committee','commitee':'committee','comparision':'comparison','completly':'completely',
  'concious':'conscious','curiousity':'curiosity','definately':'definitely','definetely':'definitely',
  'dependant':'dependent','desicion':'decision','developement':'development','diffrent':'different',
  'diffrence':'difference','dilemna':'dilemma','dissapoint':'disappoint','embarass':'embarrass',
  'equiptment':'equipment','existance':'existence','experiance':'experience','familar':'familiar',
  'finaly':'finally','foriegn':'foreign','fourty':'forty','foward':'forward','gard':'guard',
  'grammer':'grammar','greatful':'grateful','hight':'height','humourous':'humorous',
  'immediatly':'immediately','independant':'independent','indispensible':'indispensable',
  'inteligent':'intelligent','interupt':'interrupt','irrelevent':'irrelevant','leasure':'leisure',
  'lenght':'length','liesure':'leisure','maintainance':'maintenance','managment':'management',
  'millenium':'millennium','miniscule':'minuscule','mispell':'misspell','momento':'memento',
  'noticable':'noticeable','occassion':'occasion','occassionally':'occasionally',
  'paralel':'parallel','parliment':'parliament','particulary':'particularly','persistant':'persistent',
  'personel':'personnel','posession':'possession','practise':'practice','prefering':'preferring',
  'priviledge':'privilege','proffesional':'professional','pronounciation':'pronunciation',
  'publically':'publicly','questionaire':'questionnaire','recomendation':'recommendation',
  'refered':'referred','relevent':'relevant','religous':'religious','remeber':'remember',
  'resistence':'resistance','restarant':'restaurant','rythm':'rhythm','saftey':'safety',
  'seperate':'separate','sieze':'seize','similer':'similar','sincerly':'sincerely',
  'speach':'speech','strenght':'strength','succesfully':'successfully','suprize':'surprise',
  'surprize':'surprise','tatoo':'tattoo','tendancy':'tendency','therefor':'therefore',
  'threshhold':'threshold','tommorrow':'tomorrow','truely':'truly','unfortunatly':'unfortunately',
  'unneccessary':'unnecessary','usefull':'useful','vacume':'vacuum','vegatable':'vegetable',
  'vehical':'vehicle','wierd':'weird','withold':'withhold','writting':'writing',
  'tank':'thank','tanks':'thanks','adivce':'advice','advices':'advice',
  'informations':'information','knowledges':'knowledge','peoples':'people',
  'equipments':'equipment','furnitures':'furniture','homeworks':'homework',
  'moneys':'money','researches':'research',
  'enviromental':'environmental','responsable':'responsible','succesfully':'successfully',
  'comunication':'communication','acomodation':'accommodation',
  'increse':'increase','imporve':'improve','konw':'know'
};

/* ---------------- 常见搭配/用法错误 ---------------- */
const COLLOCATION_ERRORS = [
  { re: /\bmake\s+a\s+progress\b/gi, right: 'make progress', reason: 'progress 不可数' },
  { re: /\bmake\s+progresses\b/gi, right: 'make progress', reason: 'progress 不可数' },
  { re: /\bdiscuss\s+about\b/gi, right: 'discuss', reason: 'discuss 及物，不加 about' },
  { re: /\baccording\s+to\s+me\b/gi, right: 'in my opinion', reason: 'according to 不用于第一人称观点' },
  { re: /\bin\s+the\s+other\s+hand\b/gi, right: 'on the other hand', reason: '固定搭配' },
  { re: /\bon\s+the\s+contrary\b/gi, right: 'on the contrary（仅用于否定后）', reason: '常被误用于转折' },
  { re: /\blook\s+forward\s+to\s+(hear|see|meet|receive|get)\b/gi, right: 'look forward to hearing/seeing/meeting', reason: 'to 为介词，后接动名词' },
  { re: /\bbe\s+interested\s+about\b/gi, right: 'be interested in', reason: '固定搭配' },
  { re: /\bpay\s+attention\s+on\b/gi, right: 'pay attention to', reason: '固定搭配' },
  { re: /\bconcentrate\s+in\b/gi, right: 'concentrate on', reason: '固定搭配' },
  { re: /\bdepend\s+of\b/gi, right: 'depend on', reason: '固定搭配' },
  { re: /\bconsist\s+of\b(?!\s+\w)/gi, right: 'consist of', reason: '检查是否漏宾语' },
  { re: /\bparticipate\s+\w+\s+in\b/gi, right: 'participate in', reason: 'participate 不及物' },
  { re: /\bjoin\s+in\s+the\s+(club|activity|competition)\b/gi, right: 'join the club / take part in the activity', reason: 'join in 多用于活动过程' },
  { re: /\bsuggest\s+sb\s+to\s+do\b/gi, right: 'suggest that sb (should) do / suggest doing', reason: 'suggest 不接不定式作宾补' },
  { re: /\badvise\s+sb\s+doing\b/gi, right: 'advise sb to do / advise doing', reason: '搭配错误' },
  { re: /\bhow\s+to\s+say\b/gi, right: 'what to say / how to say it', reason: 'say 需带宾语' },
  { re: /\bvery\s+much\s+(like|love|enjoy)\b/gi, right: 'like/love/enjoy ... very much', reason: '语序' },
  { re: /\bmore\s+better\b/gi, right: 'better', reason: '重复比较级' },
  { re: /\bmore\s+easier\b/gi, right: 'easier', reason: '重复比较级' },
  { re: /\bmost\s+best\b/gi, right: 'best', reason: '重复最高级' },
  { re: /\bcan\s+be\s+able\s+to\b/gi, right: 'can / be able to', reason: '语义重复' },
  { re: /\bin\s+my\s+point\s+of\s+view\b/gi, right: 'from my point of view', reason: '介词错误' },
  { re: /\bwith\s+the\s+help\s+of\s+my\s+teacher'?s\s+help\b/gi, right: 'with my teacher\'s help', reason: '重复' },
  { re: /\btake\s+part\s+in\s+part\s+in\b/gi, right: 'take part in', reason: '重复' },
  { re: /\bsuch\s+as\s+for\s+example\b/gi, right: 'such as / for example（择一）', reason: '重复' },
  { re: /\bI\s+am\s+write\s+to\b/gi, right: 'I am writing to', reason: '时态/形式错误' },
  { re: /\bI\s+write\s+to\s+you\s+to\b/gi, right: 'I am writing to you to', reason: '书信固定表达' },
  { re: /\bthank\s+you\s+for\s+your\s+reading\b/gi, right: 'thank you for reading', reason: '搭配' },
  { re: /\bin\s+conclusion\s*,?\s*in\s+a\s+word\b/gi, right: 'in conclusion / in a word（择一）', reason: '重复' }
];

/* ---------------- 内置题库 ---------------- */
const PRESETS = [
  {
    id: 'oral-feedback',
    name: '示例 1 · 给外教的英语口语课反馈（反馈信）',
    prompt: '假定你是李华，你的外教 Ryan 想了解你们对英语口语课的看法。请你给他写一封邮件，内容包括：\n1. 你对课程的整体评价；\n2. 课程存在的问题；\n3. 你的改进建议。\n注意：1. 词数 80 左右；2. 可以适当增加细节，以使行文连贯。',
    format: true,
    points: [
      { title: '对课程的整体评价', keys: 'helpful,useful,interesting,enjoy,benefit,gain,improve,oral English,spoken English,good,great,评价' },
      { title: '课程存在的问题', keys: 'problem,however,difficult,too many,large class,lack,no chance,little chance,hard to,not enough' },
      { title: '改进建议', keys: 'suggest,advice,recommend,propose,should,could,would be better,smaller group,more practice,hope' }
    ],
    demo: `Dear Ryan,
I'm Li Hua, one of your students. I'm writing to share my opinions about our oral English class.
Overall, the class is quite helpful. You always encourage us to speak out, which makes me much more confident. Besides, the topics are close to our daily life.
However, problems remain. With over fifty students in one class, each of us has little chance to practise.
Therefore, I suggest dividing us into smaller groups so that everyone can get more practice.
Thank you for your hard work.
Yours,
Li Hua`
  },
  {
    id: 'group-exchange',
    name: '示例 2 · 请求交换演讲分组（请求信）',
    prompt: '假定你是李华，外教要求你们分组准备一场英语演讲。你想和同学 Chris 交换分组，因为你的搭档请假了。请你给 Chris 写一封邮件，内容包括：\n1. 说明想交换分组的原因；\n2. 提出交换的请求；\n3. 表达感谢与期待。',
    format: true,
    points: [
      { title: '说明交换分组的原因', keys: 'because,since,partner,absent,sick,leave,reason,my partner' },
      { title: '提出交换分组的请求', keys: 'exchange,swap,switch,change,would you,would it be possible,could you,with you,your group' },
      { title: '表达感谢与期待', keys: 'thank,grateful,appreciate,look forward,hope,reply,please' }
    ],
    demo: `Dear Chris,
I'm writing to ask whether you would like to exchange groups with me for the coming speech.
My partner Tom will be absent next week, so I am afraid I cannot finish the task alone. I know your group has four members, and I wonder if it is possible for me to join you.
If it is convenient, please let me know before Friday. I would be grateful for your help.
Looking forward to your reply.
Yours,
Li Hua`
  },
  {
    id: 'culture-intro',
    name: '示例 3 · 向外国朋友介绍中国传统艺术（介绍信）',
    prompt: '假定你是李华，你的英国朋友 Peter 对中国传统艺术很感兴趣。请你给他写一封信，内容包括：\n1. 介绍一种你熟悉的传统艺术（如剪纸、书法、京剧）；\n2. 说明它的特点；\n3. 邀请他来中国体验。',
    format: true,
    points: [
      { title: '介绍一种传统艺术', keys: 'paper cutting,paper-cutting,calligraphy,Peking Opera,traditional art,culture,China' },
      { title: '说明它的特点', keys: 'history,long,feature,characteristic,symbol,pattern,skill,require,patience,beautiful' },
      { title: '邀请他来中国体验', keys: 'invite,welcome,come to China,visit,experience,try,look forward' }
    ],
    demo: `Dear Peter,
I'm glad that you are interested in traditional Chinese art. I would like to introduce paper-cutting to you.
Paper-cutting has a history of over a thousand years. People cut red paper into patterns like flowers and animals. It is often used to decorate windows during the Spring Festival, which stands for good luck.
What makes it special is that it requires great patience. Faced with a plain piece of paper, a skilled artist can turn it into a work of art.
I sincerely invite you to come to China and experience it.
Yours,
Li Hua`
  },
  {
    id: 'notice',
    name: '示例 4 · 学校英语角活动通知（通知）',
    prompt: '假定你是学生会主席李华，学校将举办英语角活动。请你用英语写一则通知，内容包括：\n1. 活动的时间与地点；\n2. 活动的主要内容；\n3. 参加的方式与要求。',
    format: false,
    points: [
      { title: '活动时间与地点', keys: 'time,place,Friday,Saturday,next week,3 p.m.,in the,hall,playground,room' },
      { title: '活动主要内容', keys: 'topic,activity,talk,discuss,game,speech,share,introduce,free talk' },
      { title: '参加方式与要求', keys: 'sign up,register,come,join,welcome,require,please,everyone,students' }
    ],
    demo: `Notice

To improve our spoken English, the Students' Union will hold an English Corner next Friday afternoon.
The activity will take place in the school hall from 3:00 p.m. to 5:00 p.m. There will be a free talk about campus life, a short speech by our foreign teacher and some word games.
If you want to join, please sign up at the office before Wednesday. You are advised to prepare a short introduction of yourself.
Don't miss the chance!
The Students' Union`
  },
  {
    id: 'speech',
    name: '示例 5 · 主题演讲稿（演讲稿）',
    prompt: '你校英语社团将举办以 "Reading Makes a Difference" 为主题的演讲比赛。请你写一篇演讲稿参赛，内容包括：\n1. 阅读对你的影响；\n2. 举一个具体例子；\n3. 呼吁同学们多读书。',
    format: false,
    points: [
      { title: '阅读对你的影响', keys: 'influence,change,benefit,broaden,open my mind,help,knowledge,improve,make a difference' },
      { title: '具体例子', keys: 'for example,for instance,once,one day,when I was,a book,novel,story' },
      { title: '呼吁多读书', keys: 'call on,appeal,suggest,encourage,everyone,read more,let us,let\'s,start' }
    ],
    demo: `Good morning, everyone. My topic today is "Reading Makes a Difference".
Reading has changed me a great deal. It broadens my horizons and calms me down when I feel stressed.
Last year I failed an exam and locked myself in my room. A novel I picked up that day told me that failure is not the end, which gave me the courage to start again.
Therefore, I call on everyone to read more. Not only does reading open a window to the world, but it also makes us better people.
Thank you.`
  }
];

/* ---------------- 导出到全局 ---------------- */
window.RUBRIC = RUBRIC;
window.CONNECTIVES = CONNECTIVES;
window.PATTERNS = PATTERNS;
window.ADVANCED_WORDS = ADVANCED_WORDS;
window.SPELLING_ERRORS = SPELLING_ERRORS;
window.COLLOCATION_ERRORS = COLLOCATION_ERRORS;
window.PRESETS = PRESETS;
