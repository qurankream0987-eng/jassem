# JASIM — الشروط التي عليك مراجعتها، حيث يمكنك رؤيتها

`PRESENTATION != CANONICAL STATE`

---

## 1. لماذا بقيت الشبكة

ضغطةُ البطاقة أنشأت **طلباً مسودة قانونياً** وربطته بالمحادثة تحت `current:order`. والورشة
ظلّت تعرض شبكة البحث، لأنّ:

```ts
currentPresentation = presentationFromMessage(latestMessage.metadata)
```

والإرسالُ الموثوق **لا يكتب رسالة**. فـ`refreshProjection: true` يُعيد قراءة **نفس الصفّ**،
وشروطُ المراجعة كانت قانونيةً ومُثبَّتةً و**لا مكان لها على الشاشة**.

## 2. قاعدةُ الأسبقية — عامّة، ومقيَّدة ثلاثاً

```
SOMETHING OF THIS CONVERSATION THAT IS WAITING ON THIS PERSON
OUTRANKS SOMETHING THEY WERE MERELY SHOWN
```

وكلُّ قيدٍ منها **رفض**:

| القيد | ما يمنعه |
|---|---|
| الربط `(owner, conversation)` و`supersededAt IS NULL` | `CROSS_CONVERSATION_DRAFT_SURFACE = 0` · `OLD_DRAFT_HIJACKS_NEW_CONVERSATION = 0` |
| إعادة قراءة صفّ الطلب تحت هذا المالك | `CROSS_OWNER_DRAFT_SURFACE = 0` |
| `status = DRAFT` و`proposalId IS NULL` | ما أُرسِل ينتظر الطرف الآخر، لا هذا الشخص |

واختيارٌ ثانٍ **يَنسخ** الربط الأول (`bindReference` داخل معاملة)، فالمعروض دائماً الطلب
الصحيح، **والأول باقٍ** لا محذوف.

```
SECOND_SELECTION_REVIEWS_WRONG_ORDER = 0
HIDING_REVIEW_DELETES_DRAFT = 0   NEW_ORDER_STATE_TABLE = NO
```

## 3. ما يُقرأ — وما لا يُقرأ

```
LATEST_OFFERING_TERMS_REPLACE_DRAFT_TERMS = 0
```

**شروط المسودة المُثبَّتة وحدها.** العرضُ لا يُعاد قراءته هنا إطلاقاً، فصاحبٌ غيّر شروطه بعد
الاختيار لا يمكن أن تُعرَض شروطُه الجديدة كأنها ما اختاره هذا الشخص. ومُثبَت: بعد إعادة نشرٍ
بـ`capacity: 99`، يظلّ السطح يعرض `capacity: 20 t`.

والاسمُ يأتي من **صفّ المرشّح المُجمَّد** وقت الاكتشاف — لا يُحدَّث أبداً — فالشيء مُسمّى كما
رآه الشخص، لا كما صار.

## 4. ولا مكوّن جديد، ولا بدائيّة جديدة

السطح `DETAIL`، و`renderDetail` يستدعي **نفس البطاقة** التي ترسم الشبكة. والشروط تمرّ عبر
`surfaceAttributes` نفسها المبنيّة سابقاً — تُسقِط المَكِنة وتُسطِّح مستوىً وتَقرِن الوحدة.

```
DOMAIN_ORDER_REVIEW_COMPONENTS_ADDED = 0   NEW_ORDER_RUNTIME = NO
```

وخمسةُ أشياء لا تجمعها جامعة — تأجير مِجَسّ بحري، وتخزين بارد مؤقّت، وترميم مخطوطات، وطاقة
رفع، وفحص مياه متنقّل — تمرّ من **نفس السطح** بلا فرعٍ واحد.

## 5. ولا زرّ — لأنّ لا مسار

```
BUTTON != EXECUTION AUTHORITY · SHOWING TERMS != ACCEPTING TERMS
```

التتبّع وجد أنّ **لا نوعَ فعلٍ موثوق يُرسِل مسودة**: `CREATE_PROPOSAL` مسارُه ما زال
`unavailableRoute` وحمولتُه نصُّ هدف. فزرُّ موافقةٍ هنا كان سيكون **زرّاً خلفه لا شيء**.
فالسطح يعرض ولا يَعِد، وطريقُ الموافقة الموجود — أن يقولها الشخص — لم يُمَسّ.

```
SELECT_PRESS_COUNTS_AS_APPROVAL = 0
DRAFT_SURFACE_AUTO_PROPOSES = 0  _AGREES = 0  _TRANSACTS = 0  _PAYS = 0
```

## 6. ما قِيس في متصفّحٍ حقيقي

ضغطةٌ حقيقية على **البطاقة الثالثة**:

```
hostPrimitive  ENTITY_GRID  →  DETAIL
المعروض        marine.sensor.rental · DRAFT · 1,250 SAR · مِجَسّ بحري 4
               mass 19 kg · ratedDepth 450 m
أزرار السطح    0
commercial_orders = 1  status = DRAFT  proposalId = NULL
agreements = 0  transactions = 0  payment_intents = 0  economic_proposals = 0
بعد التحديث    DETAIL (نفسه)      بعد المغادرة والعودة  DETAIL (نفسه) ×3 مقاسات
MOBILE_390X844 = PASS  MOBILE_430X932 = PASS  DESKTOP_1440X900 = PASS
HORIZONTAL_PAGE_SCROLL = 0  COMPOSER_USABLE = PASS
```

## 7. ما بقي صادقاً — وهو مقيسٌ لا مُخمَّن

حين يتولّى سطحُ المراجعة، **تعود الشبكة إلى فقاعة الرسالة** (لأنّ المُضيف صار يُطالِب بالطلب
لا بالرسالة). وقِيس بعد الضغط:

```
actionButtons = 6   insideHost = 0   inMessageBubble = 6
```

وضغطُ بطاقةٍ في الفقاعة **يرفض بصدق**: «الإجراء ... لا يملك سطحًا موثوقًا متاحًا الآن» — لأنّ
مسار الفقاعة لم يملك سطحاً موثوقاً قطّ. فالقانون `BUTTON != EXECUTION AUTHORITY` قائم (ترفض
ولا تتظاهر)، **لكنّ زرّاً مرئياً لا يفعل شيئاً عيبٌ على أيّ حال**. وهذه المرحلة لم تُحدِثه،
بل **أظهرته**.
