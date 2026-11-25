(() => {
    "use strict";

    const IMAGE_ROOT = "/frontend/images/produce/";
    const CATEGORIES = [
        { id: "all", key: "produce.category.all", icon: "▦" },
        { id: "vegetables", key: "produce.category.vegetables", icon: "🥕" },
        { id: "fruits", key: "produce.category.fruits", icon: "🍊" },
        { id: "spices", key: "produce.category.spices", icon: "🌶️" },
        { id: "leafy_vegetables", key: "produce.category.leafy", icon: "🥬" },
        { id: "root_tuber_crops", key: "produce.category.roots", icon: "🥔" },
        { id: "grains_pulses", key: "produce.category.grains", icon: "🌾" },
        { id: "gourds_climbing_vegetables", key: "produce.category.gourds", icon: "🎃" },
        { id: "herbs", key: "produce.category.herbs", icon: "🌿" },
        { id: "other_crops", key: "produce.category.other", icon: "🧺" },
    ];

    // Exact crop photos only. Do not label a different crop's photo as an exact match.
    const PHOTO_RULES = [
        { file: "cinnamon.jpg", category: "spices", names: ["cinnamon", "cinnamon bark", "ceylon cinnamon", "කුරුඳු", "இலவங்கப்பட்டை"] },
        { file: "black-pepper.jpg", category: "spices", names: ["black pepper", "black peppers", "black peppercorn", "black peppercorns", "peppercorn", "peppercorns", "piper nigrum", "ගම්මිරිස්", "மிளகு"] },
        { file: "cardamom.jpg", category: "spices", names: ["cardamom", "cardamoms", "green cardamom", "එනසාල්", "ஏலக்காய்"] },
        { file: "nutmeg.jpg", category: "spices", names: ["nutmeg", "nutmegs", "nutmeg seed", "nutmeg seeds", "සාදික්කා", "ஜாதிக்காய்"] },
        { file: "mace.jpg", category: "spices", names: ["mace", "mace spice", "nutmeg aril", "myristica fragrans aril", "වසාවාසි", "ஜாதிப்பத்திரி"] },
        { file: "turmeric.jpg", category: "spices", names: ["turmeric", "turmeric root", "turmeric roots", "කහ", "மஞ்சள்"] },
        { file: "ginger.jpg", category: "spices", names: ["ginger", "gingers", "ginger root", "ginger roots", "ඉඟුරු", "இஞ்சி"] },
        { file: "coriander-seeds.jpg", category: "spices", names: ["coriander seed", "coriander seeds", "seeds of coriander", "කොත්තමල්ලි ඇට", "கொத்தமல்லி விதை", "கொத்தமல்லி விதைகள்"] },
        { file: "soursop.jpg", category: "fruits", names: ["soursop", "soursops", "කටු අනෝදා", "முள்ளு சீதாப்பழம்"] },
        { file: "star-fruit.jpg", category: "fruits", names: ["star fruit", "starfruit", "කාමරංගා", "நட்சத்திரப்பழம்"] },
        { file: "king-coconut.jpg", category: "fruits", names: ["king coconut", "king coconuts", "thambili", "තැඹිලි", "இளநீர்"] },
        { file: "avocado.jpg", category: "fruits", names: ["avocado", "avocados", "අලිගැටපේර", "வெண்ணெய்ப்பழம்"] },
        { file: "watermelon.jpg", category: "fruits", names: ["watermelon", "watermelons", "කොමඩු", "தர்பூசணி"] },
        { file: "passion-fruit.jpg", category: "fruits", names: ["passion fruit", "passionfruit", "passion fruits", "වැල් දොඩම්", "பாசன் பழம்"] },
        { file: "wood-apple.jpg", category: "fruits", names: ["wood apple", "wood apples", "விளாம்பழம்", "දිවුල්"] },
        { file: "long-beans.jpg", category: "vegetables", names: ["long bean", "long beans", "yardlong bean", "yardlong beans", "yard long bean", "yard long beans", "මෑ කරල්", "நீள பீன்ஸ்"] },
        { file: "jackfruit.jpg", category: "fruits", names: ["jackfruit", "jack fruits", "jack fruit", "කොස්", "பலாப்பழம்"] },
        { file: "rambutan.jpg", category: "fruits", names: ["rambutan", "rambutans", "රඹුටන්", "ரம்புட்டான்"] },
        { file: "mangosteen.jpg", category: "fruits", names: ["mangosteen", "mangosteens", "manggis", "මැංගුස්", "மங்குஸ்தான்"] },
        { file: "cauliflower.jpg", category: "vegetables", names: ["cauliflower", "cauliflowers", "ගෝවා මල්", "காலிஃபிளவர்"] },
        { file: "broccoli.jpg", category: "vegetables", names: ["broccoli", "broccolis", "බ්‍රොකොලි", "ப்ரோக்கோலி"] },
        { file: "drumstick.jpg", category: "vegetables", names: ["drumstick", "drumsticks", "moringa pod", "moringa pods", "මුරුංගා", "முருங்கைக்காய்"] },
        { file: "capsicum.jpg", category: "vegetables", names: ["capsicum", "bell pepper", "මාළු මිරිස්", "குடைமிளகாய்"] },
        { file: "cucumber.jpg", category: "vegetables", names: ["cucumber", "cucumbers", "පිපිඤ්ඤා", "வெள்ளரிக்காய்"] },
        { file: "guava.jpg", category: "fruits", names: ["guava", "guavas", "පේර", "கொய்யா"] },
        { file: "lime.jpg", category: "fruits", names: ["lime", "limes", "lemon", "lemons", "දෙහි", "எலுமிச்சை"] },
        { file: "cloves.jpg", category: "spices", names: ["clove", "cloves", "කරාබු නැටි", "கிராம்பு"] },
        { file: "curry-leaves.jpg", category: "herbs", names: ["curry leaf", "curry leaves", "කරපිංචා", "கறிவேப்பிலை"] },
        { file: "lemongrass.jpg", category: "herbs", names: ["lemongrass", "lemon grass", "cymbopogon citratus", "සේර", "எலுமிச்சைப்புல்"] },
        { file: "mukunuwenna.jpg", category: "leafy_vegetables", names: ["mukunuwenna", "mukunu-wenna", "alternanthera sessilis", "sessile joyweed", "මුකුණුවැන්න", "මුකුණුවැන්න කොළ", "பொன்னாங்கண்ணி"] },
        { file: "nivithi.jpg", category: "leafy_vegetables", names: ["nivithi", "nivithiya", "green nivithi", "malabar spinach", "ceylon spinach", "indian spinach", "basella alba", "නිවිති", "නිවිති කොළ", "பசலைக்கீரை", "பசலை கீரை", "பசளி"] },
        { file: "thampala.jpg", category: "leafy_vegetables", names: ["thampala", "tampala", "amaranthus tricolor", "chinese amaranth", "තම්පලා", "தண்டுக்கீரை", "சிறுகீரை"] },
        { file: "sarana.jpg", category: "leafy_vegetables", names: ["sarana", "heen sarana", "hin sarana", "trianthema portulacastrum", "සාරණ", "හීන් සාරණ", "சாரணை"] },
        { file: "spinach.jpg", category: "leafy_vegetables", names: ["spinach", "true spinach", "spinacia oleracea", "ස්පිනච්", "பாலக் கீரை", "பாலக்கீரை"] },
        { file: "mint.jpg", category: "herbs", names: ["mint", "spearmint", "mentha spicata", "මිංචි", "මින්චි", "புதினா"] },
        { file: "coriander-leaves.jpg", category: "herbs", names: ["coriander leaf", "coriander leaves", "cilantro", "coriandrum sativum leaves", "කොත්තමල්ලි කොළ", "கொத்தமல்லி இலை", "கொத்தமல்லி இலைகள்"] },
        { file: "parsley.jpg", category: "herbs", names: ["parsley", "garden parsley", "petroselinum crispum", "පාර්ස්ලි", "පාස්ලි", "பார்ஸ்லி"] },
        { file: "basil.jpg", category: "herbs", names: ["basil", "sweet basil", "ocimum basilicum", "සුවඳ තලා", "හීන් මදුරුතලා", "பேசில்"] },
        { file: "dill.jpg", category: "herbs", names: ["dill", "dill leaves", "anethum graveolens", "දිල්", "சதகுப்பி", "சதகுப்பை"] },
        { file: "kankun.jpg", category: "leafy_vegetables", names: ["kankun", "kangkung", "water spinach", "කංකුං", "வள்ளிக்கீரை"] },
        { file: "ladies-fingers.jpg", category: "vegetables", names: ["ladies fingers", "lady finger", "okra", "බණ්ඩක්කා", "வெண்டைக்காய்"] },
        { file: "gotukola.jpg", category: "leafy_vegetables", names: ["gotukola", "gotu kola", "centella", "centella asiatica", "ගොටුකොළ", "வல்லாரை"] },
        { file: "tomatoes.jpg", category: "vegetables", names: ["tomato", "tomatoes", "tomatos", "තක්කාලි", "தக்காளி"] },
        { file: "carrots.jpg", category: "root_tuber_crops", names: ["carrot", "carrots", "කැරට්", "கேரட்"] },
        { file: "radish.jpg", category: "root_tuber_crops", names: ["radish", "radishes", "red radish", "cherry radish", "raphanus sativus", "රාබු", "முள்ளங்கி"] },
        { file: "cassava.jpg", category: "root_tuber_crops", names: ["manioc", "cassava", "yuca", "manihot esculenta", "මඤ්ඤොක්කා", "மரவள்ளிக்கிழங்கு"] },
        { file: "sweet-potato.jpg", category: "root_tuber_crops", names: ["sweet potato", "sweet potatoes", "ipomoea batatas", "බතල", "சர்க்கரைவள்ளிக்கிழங்கு", "சர்க்கரைவள்ளி கிழங்கு"] },
        { file: "innala.jpg", category: "root_tuber_crops", names: ["innala", "country potato", "koorka", "plectranthus rotundifolius", "coleus rotundifolius", "ඉන්නල", "சிறுகிழங்கு", "சிறு கிழங்கு"] },
        { file: "elephant-yam.jpg", category: "root_tuber_crops", names: ["elephant yam", "elephant foot yam", "elephant's foot yam", "amorphophallus paeoniifolius", "amorphophallus campanulatus", "කිඩාරං", "කිදාර", "கருணைக்கிழங்கு", "கருணை"] },
        { file: "bitter-gourd.jpg", category: "gourds_climbing_vegetables", names: ["bitter gourd", "bitter gourds", "bitter melon", "balsam pear", "momordica charantia", "කරවිල", "பாகற்காய்"] },
        { file: "snake-gourd.jpg", category: "gourds_climbing_vegetables", names: ["snake gourd", "snake gourds", "trichosanthes cucumerina", "පතෝල", "புடோல்", "புடலங்காய்"] },
        { file: "ash-pumpkin.jpg", category: "gourds_climbing_vegetables", names: ["ash pumpkin", "ash gourd", "winter melon", "wax gourd", "benincasa hispida", "අළු පුහුල්", "අළු පුහුල", "சாம்பல் பூசணி", "வெண்பூசணி", "நீர்ப்பூசணி"] },
        { file: "bottle-gourd.jpg", category: "gourds_climbing_vegetables", names: ["bottle gourd", "bottle gourds", "long gourd", "calabash", "lagenaria siceraria", "ලබු", "சுரைக்காய்"] },
        { file: "green-beans.jpg", category: "vegetables", names: ["bean", "beans", "green bean", "green beans", "string bean", "බෝංචි", "பீன்ஸ்", "பச்சை பீன்ஸ்"] },
        { file: "cabbage.jpg", category: "leafy_vegetables", names: ["cabbage", "cabbages", "ගෝවා", "முட்டைக்கோஸ்"] },
        { file: "eggplant.jpg", category: "vegetables", names: ["brinjal", "brinjals", "eggplant", "eggplants", "egg plant", "aubergine", "aubergines", "වම්බටු", "கத்திரிக்காய்", "கத்தரிக்காய்"] },
        { file: "pumpkin.jpg", category: "gourds_climbing_vegetables", names: ["pumpkin", "pumpkins", "වට්ටක්කා", "பூசணி"] },
        { file: "potatoes.jpg", category: "root_tuber_crops", names: ["potato", "potatoes", "spud", "spuds", "අර්තාපල්", "உருளைக்கிழங்கு"] },
        { file: "onions.jpg", category: "root_tuber_crops", names: ["onion", "onions", "ලූනු", "ලූණු", "வெங்காயம்"] },
        { file: "green-chillies.jpg", category: "spices", names: ["green chilli", "green chillies", "green chili", "green chilies", "chilli", "chillies", "chili", "chilies", "කොච්චි", "මිරිස්", "மிளகாய்", "பச்சை மிளகாய்"] },
        { file: "oranges.jpg", category: "fruits", names: ["orange", "oranges", "දොඩම්", "ஆரஞ்சு"] },
        { file: "apples.jpg", category: "fruits", names: ["apple", "apples", "ඇපල්", "ஆப்பிள்"] },
        { file: "bananas.jpg", category: "fruits", names: ["banana", "bananas", "කෙසෙල්", "வாழைப்பழம்", "வாழை"] },
        { file: "mangoes.jpg", category: "fruits", names: ["mango", "mangos", "mangoes", "අඹ", "மாம்பழம்"] },
        { file: "papaya.jpg", category: "fruits", names: ["papaya", "papayas", "pawpaw", "pawpaws", "පැපොල්", "பப்பாளி"] },
        { file: "pineapple.jpg", category: "fruits", names: ["pineapple", "pineapples", "ananas", "අන්නාසි", "அன்னாசி", "அன்னாசிப்பழம்"] },
        { file: "beetroot.jpg", category: "root_tuber_crops", names: ["beetroot", "beet roots", "beet", "beta vulgaris", "බීට් රූට්", "බීට්", "பீட்ரூட்"] },
        { file: "kiriala.jpg", category: "root_tuber_crops", names: ["kiriala", "kiri ala (colocasia)", "taro", "colocasia", "colocasia esculenta", "කිරියාල", "ගහල", "சேப்பங்கிழங்கு"] },
        { file: "kiri-ala.jpg", category: "root_tuber_crops", names: ["kiri ala", "desi ala", "xanthosoma", "xanthosoma sagittifolium", "කිරි අල", "சேம்பு கிழங்கு", "கிரி ஆலா"] },
        { file: "ridge-gourd.jpg", category: "gourds_climbing_vegetables", names: ["ridge gourd", "angled luffa", "luffa acutangula", "වැටකොළු", "பீர்க்கங்காய்"] },
        { file: "leeks.jpg", category: "vegetables", names: ["leek", "leeks", "allium ampeloprasum var porrum", "allium porrum", "ලීක්ස්", "லீக்ஸ்"] },
        { file: "dragon-fruit.jpg", category: "fruits", names: ["dragon fruit", "dragonfruit", "pitaya", "pitahaya", "hylocereus undatus", "ඩ්‍රැගන් පෘට්", "டிராகன் பழம்"] },
        { file: "rice.jpg", category: "grains_pulses", names: ["rice", "paddy", "oryza sativa", "වී", "සහල්", "நெல்", "அரிசி"] },
        { file: "maize.jpg", category: "grains_pulses", names: ["maize", "corn", "corn cob", "zea mays", "බඩ ඉරිඟු", "බඩඉරිඟු", "மக்காச்சோளம்"] },
        { file: "green-gram.jpg", category: "grains_pulses", names: ["green gram", "mung", "mung bean", "mung beans", "vigna radiata", "මුං ඇට", "මුං", "பாசிப்பயறு"] },
        { file: "cowpea.jpg", category: "grains_pulses", names: ["cowpea", "cowpeas", "vigna unguiculata", "කව්පි", "කවුපි", "காராமணி"] },
        { file: "black-gram.jpg", category: "grains_pulses", names: ["black gram", "urad", "urad dal", "vigna mungo", "උඳු", "உளுந்து"] },
        { file: "groundnut.jpg", category: "grains_pulses", names: ["groundnut", "groundnuts", "peanut", "peanuts", "arachis hypogaea", "රටකජු", "நிலக்கடலை"] },
        { file: "sesame.jpg", category: "grains_pulses", names: ["sesame", "sesame seed", "sesame seeds", "sesamum indicum", "තල", "எள்"] },
        { file: "tea.jpg", category: "other_crops", names: ["tea", "tea leaf", "tea leaves", "camellia sinensis", "තේ", "தேயிலை"] },
        { file: "rubber.jpg", category: "other_crops", names: ["rubber", "rubber tree", "latex", "hevea brasiliensis", "රබර්", "இறப்பர்"] },
        { file: "coffee.jpg", category: "other_crops", names: ["coffee", "coffee cherry", "coffee cherries", "coffea arabica", "කෝපි", "காப்பி"] },
        { file: "cocoa.jpg", category: "other_crops", names: ["cocoa", "cacao", "theobroma cacao", "කොකෝවා", "கொக்கோ"] },
        { file: "cashew.jpg", category: "other_crops", names: ["cashew", "cashews", "cashew apple", "cashew nut", "anacardium occidentale", "කජු", "முந்திரி"] },
        { file: "arecanut.jpg", category: "other_crops", names: ["arecanut", "areca nut", "areca nuts", "betel nut", "betel nuts", "areca catechu", "පුවක්", "பாக்கு"] },
        { file: "betel.jpg", category: "other_crops", names: ["betel", "betel leaf", "betel leaves", "piper betle", "බුලත්", "வெற்றிலை"] },
    ];

    const CATEGORY_RULES = [
        { id: "fruits", categoryNames: ["fruit", "fruits", "පලතුරු", "பழங்கள்", "பழம்"], crops: ["mango", "banana", "papaya", "pineapple", "jackfruit", "rambutan", "mangosteen", "avocado", "guava", "watermelon", "passion fruit", "wood apple", "king coconut", "lime", "lemon", "orange", "soursop", "star fruit", "dragon fruit", "coconut", "durian", "lychee", "grape", "pear", "peach", "plum", "strawberry", "අඹ", "කෙසෙල්", "පැපොල්", "අන්නාසි", "කොස්", "රඹුටන්", "මැංගුස්", "අලිගැටපේර", "පේර", "කොමඩු", "වැල් දොඩම්", "දිවුල්", "තැඹිලි", "දෙහි", "දොඩම්", "කාමරංගා", "කටු අනෝදා", "රඹුටන්", "பலாப்பழம்", "ரம்புட்டான்", "மங்குஸ்தான்", "வெண்ணெய்ப்பழம்", "கொய்யா", "தர்பூசணி", "பாசன் பழம்", "விளாம்பழம்", "இளநீர்", "எலுமிச்சை", "ஆரஞ்சு", "நட்சத்திரப்பழம்", "டிராகன் பழம்", "மாம்பழம்", "வாழைப்பழம்", "பப்பாளி", "அன்னாசி"] },
        { id: "spices", categoryNames: ["spice", "spices", "කුළුබඩු", "மசாலா"], crops: ["chilli", "chili", "cinnamon", "pepper", "black pepper", "cardamom", "clove", "cloves", "nutmeg", "mace", "turmeric", "ginger", "garlic", "coriander seed", "කුරුඳු", "ගම්මිරිස්", "එනසාල්", "කරාබු නැටි", "සාදික්කා", "වසාවාසි", "කහ", "ඉඟුරු", "සුදු ලූනු", "කොත්තමල්ලි ඇට", "இலவங்கப்பட்டை", "மிளகு", "ஏலக்காய்", "கிராம்பு", "ஜாதிக்காய்", "ஜாதிப்பத்திரி", "மஞ்சள்", "இஞ்சி", "பூண்டு", "கொத்தமல்லி விதை"] },
        { id: "leafy_vegetables", categoryNames: ["leafy", "leafy vegetable", "leafy vegetables", "leaf vegetable", "greens", "කොළ එළවළු", "පලා", "பச்சை கீரை", "கீரை", "இலை காய்கறி"], crops: ["gotukola", "centella", "mukunuwenna", "kankun", "kangkung", "water spinach", "nivithi", "thampala", "sarana", "spinach", "kale", "lettuce", "amaranth", "leafy vegetable", "ගොටුකොළ", "මුකුණුවැන්න", "කංකුං", "නිවිති", "තම්පලා", "සාරණ", "வல்லாரை", "பொன்னாங்கண்ணி", "வள்ளிக்கீரை", "சிறுகீரை", "முளைக்கீரை", "பசலைக்கீரை"] },
        { id: "root_tuber_crops", categoryNames: ["root", "root crop", "root crops", "root vegetable", "root and tuber crops", "tuber", "අල වර්ග", "මුල් එළවළු", "கிழங்கு", "வேர் காய்கறி"], crops: ["manioc", "cassava", "sweet potato", "potato", "kiriala", "innala", "kiri ala", "elephant yam", "elephant foot yam", "yam", "raja ala", "dioscorea alata", "taro", "beetroot", "radish", "turnip", "carrot", "මඤ්ඤොක්කා", "බතල", "කිරි අල", "ඉන්නල", "කිඩාරං", "කිදාර", "රාජ අල", "කිරල", "රාබු", "බීට් රූට්", "மரவள்ளிக்கிழங்கு", "சர்க்கரைவள்ளிக்கிழங்கு", "ரசவள்ளிக்கிழங்கு", "சிறுகிழங்கு", "சேனைக்கிழங்கு", "சேப்பங்கிழங்கு", "சேம்பு கிழங்கு", "கருணைக்கிழங்கு", "முள்ளங்கி", "பீட்ரூட்"] },
        { id: "grains_pulses", categoryNames: ["grain", "grains", "pulse", "pulses", "grains and pulses", "ධාන්‍ය", "ධාන්‍ය සහ පියලි", "தானியங்கள்", "பருப்பு வகைகள்"], crops: ["rice", "paddy", "maize", "corn", "green gram", "mung bean", "mung", "cowpea", "black gram", "urad", "groundnut", "peanut", "sesame", "වී", "සහල්", "බඩ ඉරිඟු", "මුං ඇට", "කව්පි", "උඳු", "රටකජු", "තල", "நெல்", "அரிசி", "மக்காச்சோளம்", "பாசிப்பயறு", "காராமணி", "உளுந்து", "நிலக்கடலை", "எள்"] },
        { id: "gourds_climbing_vegetables", categoryNames: ["gourd", "gourds", "gourds and climbing vegetables", "කැකිරි", "වැල් එළවළු", "கொடி காய்கறிகள்"], crops: ["pumpkin", "ash pumpkin", "bitter gourd", "bitter melon", "snake gourd", "bottle gourd", "ash gourd", "ridge gourd", "sponge gourd", "long gourd", "squash", "කරවිල", "පතෝල", "ලබු", "වැටකොළු", "අළු පුහුල්", "சாம்பல் பூசணி", "வெண்பூசணி", "நீர்ப்பூசணி", "பாகற்காய்", "புடோல்", "புடலங்காய்", "சுரைக்காய்", "பீர்க்கங்காய்"] },
        { id: "herbs", categoryNames: ["herb", "herbs", "ඖෂධ පැළෑටි", "மூலிகை", "மூலிகைகள்"], crops: ["mint", "coriander leaf", "coriander leaves", "cilantro", "parsley", "basil", "dill", "curry leaf", "curry leaves", "lemongrass", "මින්චි", "කරපිංචා", "කොත්තමල්ලි කොළ", "සේර", "கொத்தமல்லி இலை", "கறிவேப்பிலை", "புதினா", "எலுமிச்சைப்புல்"] },
        { id: "vegetables", categoryNames: ["vegetable", "vegetables", "එළවළු", "காய்கறி", "காய்கறிகள்"], crops: ["tomato", "beans", "green beans", "brinjal", "eggplant", "ladies fingers", "lady finger", "okra", "capsicum", "bell pepper", "cucumber", "leek", "leeks", "cauliflower", "broccoli", "drumstick", "moringa pod", "long beans", "තක්කාලි", "බෝංචි", "වම්බටු", "බණ්ඩක්කා", "මාළු මිරිස්", "පිපිඤ්ඤා", "ලීක්ස්", "ගෝවා මල්", "බ්‍රොකොලි", "මුරුංගා", "මෑ කරල්", "வெண்டைக்காய்", "குடைமிளகாய்", "வெள்ளரிக்காய்", "லீக்ஸ்", "காலிஃபிளவர்", "ப்ரோக்கோலி", "முருங்கைக்காய்", "நீள பீன்ஸ்"] },
        { id: "other_crops", categoryNames: ["other", "other crop", "other crops", "වෙනත් බෝග", "மற்ற பயிர்கள்"], crops: ["tea", "rubber", "coffee", "cocoa", "cashew", "arecanut", "betel", "tobacco", "තේ", "රබර්", "කෝපි", "කොකෝවා", "කජු", "පුවක්", "බුලත්", "தேயிலை", "இறப்பர்", "காப்பி", "கொக்கோ", "முந்திரி", "பாக்கு", "வெற்றிலை"] },
    ];
    const CATEGORY_FALLBACKS = {
        vegetables: "produce-fallback.jpg",
        fruits: "fruit-fallback.jpg",
        spices: "green-chillies.jpg",
        leafy_vegetables: "cabbage.jpg",
        root_tuber_crops: "potatoes.jpg",
        gourds_climbing_vegetables: "pumpkin.jpg",
        grains_pulses: null,
        herbs: "gotukola.jpg",
        other_crops: "produce-fallback.jpg",
    };

    function normalize(value) {
        return String(value || "")
            .normalize("NFC")
            .toLocaleLowerCase()
            .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
            .trim();
    }

    function containsName(normalizedName, alias) {
        return (` ${normalizedName} `).includes(` ${normalize(alias)} `);
    }

    function exactPhotoFor(normalizedName) {
        return PHOTO_RULES.find((entry) => entry.names.some((alias) => normalizedName === normalize(alias)));
    }

    function classify(name, categoryName) {
        const normalizedCategory = normalize(categoryName);
        const storedCategory = CATEGORY_RULES.find((entry) => entry.categoryNames.some((alias) => containsName(normalizedCategory, alias)));
        if (storedCategory) return storedCategory.id;

        const normalizedName = normalize(name);
        const capsicum = ["capsicum", "bell pepper", "මාළු මිරිස්", "குடைமிளகாய்"]
            .some((alias) => containsName(normalizedName, alias));
        if (capsicum) return "vegetables";
        const corianderLeaf = ["coriander leaf", "coriander leaves", "cilantro", "කොත්තමල්ලි කොළ", "கொத்தமல்லி இலை"]
            .some((alias) => containsName(normalizedName, alias));
        if (corianderLeaf) return "herbs";
        if (["coriander", "කොත්තமല്ലி", "கொத்தமல்லி"].includes(normalizedName)) return "spices";

        const exactPhoto = exactPhotoFor(normalizedName);
        if (exactPhoto) return exactPhoto.category;

        const cropMatch = CATEGORY_RULES.find((entry) => entry.crops.some((alias) => containsName(normalizedName, alias)));
        return cropMatch ? cropMatch.id : "other_crops";
    }

    function fallbackFor(name, categoryName) {
        const unresolvedAroidAliases = ["kiriala", "kiri ala", "කිරියාල", "ගහල", "சேப்பங்கிழங்கு", "சேம்பு கிழங்கு"];
        if (unresolvedAroidAliases.some((alias) => normalize(alias) === normalize(name))) return null;
        return CATEGORY_FALLBACKS[classify(name, categoryName)] || null;
    }

    function resolve(name, categoryName) {
        const normalizedName = normalize(name);
        const exactPhoto = exactPhotoFor(normalizedName);
        return exactPhoto ? exactPhoto.file : fallbackFor(name, categoryName);
    }

    function mountCategoryFilter(container, onSelect, initialCategory = "all") {
        if (!container) return { setActive: () => {}, getActive: () => "all" };
        const validIds = new Set(CATEGORIES.map((item) => item.id));
        let active = validIds.has(initialCategory) ? initialCategory : "all";
        container.replaceChildren();

        CATEGORIES.forEach((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "sf-produce-category-button";
            button.dataset.produceCategoryValue = item.id;
            button.setAttribute("aria-pressed", String(item.id === active));
            const icon = document.createElement("span");
            icon.className = "sf-produce-category-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = item.icon;
            const label = document.createElement("span");
            label.dataset.i18n = item.key;
            label.textContent = window.SmartFarmerI18n?.translateKey(item.key, document.documentElement.lang || "en") || item.key;
            button.append(icon, label);
            container.appendChild(button);
        });

        const setActive = (id) => {
            active = validIds.has(id) ? id : "all";
            container.querySelectorAll("[data-produce-category-value]").forEach((button) => {
                const selected = button.dataset.produceCategoryValue === active;
                button.classList.toggle("is-active", selected);
                button.setAttribute("aria-pressed", String(selected));
            });
        };

        const updateLabels = () => {
            const locale = document.documentElement.lang || "en";
            container.querySelectorAll("[data-i18n]").forEach((label) => {
                const message = window.SmartFarmerI18n?.translateKey(label.dataset.i18n, locale);
                if (message) label.textContent = message;
            });
        };

        if (container.dataset.categoryFilterReady !== "true") {
            container.dataset.categoryFilterReady = "true";
            container.addEventListener("click", (event) => {
                const button = event.target.closest("[data-produce-category-value]");
                if (!button || !container.contains(button)) return;
                setActive(button.dataset.produceCategoryValue);
                onSelect?.(active);
            });
            document.addEventListener("sf:languagechange", updateLabels);
        }
        setActive(active);
        updateLabels();
        return { setActive, getActive: () => active };
    }
    function setImage(image) {
        if (!(image instanceof HTMLImageElement) || image.dataset.produceImageReady === "true") return;
        image.dataset.produceImageReady = "true";

        const name = image.dataset.produceName || image.alt.replace(/^fresh\s+/i, "");
        const categoryId = classify(name, image.dataset.produceCategory);
        const exactPhoto = exactPhotoFor(normalize(name));
        const useMixedFallback = image.dataset.produceImageFallback === "mixed";
        const fallback = useMixedFallback
            ? CATEGORY_FALLBACKS[categoryId === "fruits" ? "fruits" : "vegetables"]
            : fallbackFor(name, image.dataset.produceCategory);
        const filename = exactPhoto?.file || fallback;
        image.dataset.produceCategoryId = categoryId;
        image.dataset.produceFallback = fallback || "";

        if (!filename) {
            image.hidden = true;
            image.dataset.produceImageMissing = "true";
            return;
        }

        const setRepresentativeAlt = () => {
            if (useMixedFallback) {
                const key = "marketPrices.photoFallback";
                image.setAttribute("data-i18n-alt", key);
                image.alt = window.SmartFarmerI18n?.translateKey(key) || "Representative produce photograph";
                return;
            }
            const category = CATEGORIES.find((item) => item.id === categoryId);
            const categoryLabel = category
                ? window.SmartFarmerI18n?.translateKey(category.key, document.documentElement.lang || "en") || category.id
                : categoryId;
            const altPattern = window.SmartFarmerI18n?.translateKey("produce.category.photoAlt", document.documentElement.lang || "en")
                || "Representative photo for {name} in {category}.";
            image.alt = altPattern.replace("{name}", name || "produce").replace("{category}", categoryLabel);
        };

        if (!exactPhoto) {
            setRepresentativeAlt();
        } else if (!image.alt.trim() && name) {
            image.alt = `Fresh ${name}`;
        }
        image.hidden = false;
        image.removeAttribute("data-produce-image-missing");
        image.addEventListener("error", () => {
            if (fallback && fallback !== filename && image.dataset.produceFallbackApplied !== "true") {
                image.dataset.produceFallbackApplied = "true";
                setRepresentativeAlt();
                image.src = `${IMAGE_ROOT}${fallback}`;
            } else {
                image.hidden = true;
                image.removeAttribute("src");
            }
        });
        image.src = `${IMAGE_ROOT}${filename}`;
    }

    function scan(root) {
        if (root instanceof Element && root.matches("img[data-produce-image]")) setImage(root);
        if (root.querySelectorAll) root.querySelectorAll("img[data-produce-image]").forEach(setImage);
    }

    window.SmartFarmerProduceImages = Object.freeze({
        categories: Object.freeze(CATEGORIES.map((item) => Object.freeze({ ...item }))),
        classify,
        mountCategoryFilter,
        resolve,
        setImage,
    });
    scan(document);

    if (document.documentElement && "MutationObserver" in window) {
        const observer = new MutationObserver((records) => {
            records.forEach((record) => record.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) scan(node);
            }));
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }
})();

