// ************************************************************
// 			  	EXIT
// ************************************************************
Instance DIA_Arog_EXIT (C_INFO)
{
	npc = SLD_99005_Arog;
	nr = 999;
	condition = DIA_Arog_EXIT_Condition;
	information = DIA_Arog_EXIT_Info;
	description = "ENDE";
	permanent = TRUE;
};

Func int DIA_Arog_EXIT_Condition()
{
	return TRUE;
};

Func void DIA_Arog_EXIT_Info()
{
	AI_StopProcessInfos (self);
};

// ************************************************************
// 			  	Trialog Start
// ************************************************************
Instance TRIA_ArogAlchemist (C_INFO)
{
    npc         = SLD_99005_Arog;
    nr          = 10;
    condition   = TRIA_ArogAlchemist_condition;
    information = TRIA_ArogAlchemist_info;
    important   = TRUE;
    permanent   = 0;
    description = "ArogAlchemist";
};

func int TRIA_ArogAlchemist_condition()
{
    return TRUE;
};

func void TRIA_ArogAlchemist_info()
{
    var c_npc Arog;    Arog = Hlp_GetNpc(SLD_99005_Arog); // Ihm geh�rt der Dialog
    var c_npc AlchemistWald;   Alchemistwald = Hlp_GetNpc(SLD_99004_AlchemistWald);
    
    TRIA_Invite(Arog);   // Lade Arog in diesen Dialog ein
    TRIA_Invite(AlchemistWald); // Lade AlchemistWald in diesen Dialog ein
    TRIA_Start();         // Starte das Gespr�ch
    // Der Held und Arog m�ssen/d�rfen nicht eingeladen werden. Sie sind sowieso im Dialog.

    // Held redet nun mit Arto (self = Arto, other = Hero)
    TRIA_Next(AlchemistWald);

    DIAG_Reset();

    AI_Output (other, self, "TRIA_ArogAlchemist_00"); //Was ist denn hier los?   				 
	// Held redet nun mit Arog (self = Arog, other = Hero)

    AI_TurnToNpc(other, self);
	AI_TurnToNpc(self, other);
    AI_Output (self, other, "TRIA_ArogAlchemist_01"); //Innos steh mir bei! Noch so ein abgerissener Halsabschneider in meiner H�tte!

	AI_TurnToNpc(other, self);
	TRIA_Next(Arog);
	AI_Output (self, other, "TRIA_ArogAlchemist_02"); //Jetzt sind wir geliefert!
	
	AI_Output (other, self, "TRIA_ArogAlchemist_03"); //Ist das nicht die H�tte des Alchemisten? Ich brauche Heilung f�r einen Freund.

	TRIA_Next(AlchemistWald);
	AI_TurnToNpc(other, self);
	AI_Output (self, other, "TRIA_ArogAlchemist_04"); //Ah! Sehr gut. Hilf mir mit diesen elenden Verbrechern hier und ich werde versuchen deinem Freund zu helfen.

	TRIA_Next(Arog);
	AI_TurnToNpc(other, self);
	AI_Output (self, other, "TRIA_ArogAlchemist_05"); //Nein! Wir sind keine Verbrecher. Wir sind aus der Mine geflohen, um unser Leben zu retten. Du kannst dir nicht vorstellen, was diese verdammten Gardisten uns dort angetan haben.


	TRIA_Next(AlchemistWald);
	AI_TurnToNpc(other, self);
	AI_Output (self, other, "TRIA_ArogAlchemist_06"); //In diesem Land herrscht das Gesetz des K�nigs. Ihr seid in den Minen, weil ihr Verbrecher seid. Und aus diesem Grund werdet ihr auch dort zur�ckkehren.
	AI_Output (self, other, "TRIA_ArogAlchemist_07"); //...wenn man euch nicht aufkn�pft.

	TRIA_Next(Arog);
	AI_TurnToNpc(other, self);
	AI_Output (self, other, "TRIA_ArogAlchemist_08"); //(verzweifelt) Wir sind keine M�rder! Wir haben nie jemandem etwas angetan. Wir waren alle zusammen Tagel�hner auf den H�fen Monteras.
	AI_Output (self, other, "TRIA_ArogAlchemist_09"); //Eines Nachts haben uns die M�nner des K�nigs einfach verschleppt, ich schw�re es bei allen G�ttern!

	TRIA_Next(AlchemistWald);
	AI_TurnToNpc(other, self);
	AI_Output (self, other, "TRIA_ArogAlchemist_10"); //H�r nicht auf dieses Gejammer. Der K�nig kann tun, was er will. Sie sind keine M�rder? Gut! Geh zur Wache am Dorfeingang und bring sie hier her, dann hat diese j�mmerliche Geschichte ein Ende.
	AI_Output (self, other, "TRIA_ArogAlchemist_11"); //Sie werden es nicht wagen, mir etwas anzutun.

	TRIA_Next(Arog);
	AI_TurnToNpc(other, self);
	AI_Output (self, other, "TRIA_ArogAlchemist_12"); //Kennst du einen sicheren Ort, an dem wir uns verstecken k�nnen? Kannst du uns fortbringen? Bitte hilf uns bei unserer Flucht Zeit zu gewinnen.
	
	AI_Output (other, self, "Tria_ArogAlchemist_13"); //Ich werde mir genau �berlegen, was ich tun werde.
	
	TRIA_Next(AlchemistWald);
	AI_Output (self, other, "TRIA_ArogAlchemist_14"); //Hmpf.

	Log_CreateTopic (TOPIC_SaveBeppo, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_SaveBeppo, LOG_RUNNING);
	B_LogEntry (TOPIC_SaveBeppo, "Wo bin ich da nur hineingeraten? Ein paar entlaufene Buddler halten den Alchemisten in seiner H�tte fest, aus Angst von ihm verraten zu werden. Der Alchemist will, dass ich die Garde vom Dorf hole, um die Buddler festzunehmen. Er verspricht mir daf�r seine Hilfe. Die Buddler wollen, dass ich ihnen irgendwie aus dieser Situation helfe. Bevor ich etwas tue, sollte ich erst einmal Klarheit �ber die Situation erlangen und mich etwas umsehen.");

    TRIA_Finish();
	AI_StopProcessInfos	(self);
};


// ************************************************************
// 			  	Buddler
// ************************************************************

Instance DIA_Arog_Buddler (C_INFO)
{
	npc = SLD_99005_Arog;
	nr = 1;
	condition = DIA_Arog_Buddler_Condition;
	information = DIA_Arog_Buddler_Info;
	description = "Woher kommt ihr genau?";
};

Func int DIA_Arog_Buddler_Condition()
{
	return TRUE;
};

Func void DIA_Arog_Buddler_Info()

{
	AI_Output (other, self, "DIA_Arog_Buddler_15_0"); // Woher kommt ihr genau?
	AI_Output (self, other, "DIA_Arog_Buddler_5_6"); // Wir kommen direkt aus der alten Mine. Wir haben eine Nacht im Wald verbracht und haben dann diese H�tte entdeckt. Hugo hat es nicht geschafft...
	
	Info_AddChoice (DIA_Arog_Buddler,"Erz�hl mir mehr �ber die alte Mine.",DIA_Arog_Buddler_Mine);
	Info_AddChoice (DIA_Arog_Buddler,"Was ist euer Plan? Soll ich den Alchemisten t�ten?",DIA_Arog_Buddler_Plan);
	Info_AddChoice (DIA_Arog_Buddler,"Was wollt ihr vom Alchemisten?",DIA_Arog_Buddler_Alchemist);
	Info_AddChoice (DIA_Arog_Buddler,"Und wer bist du?",DIA_Arog_Buddler_You);
	Info_AddChoice (DIA_Arog_Buddler,"Wer ist Hugo?",DIA_Arog_Buddler_Hugo);
};	

Func void DIA_Arog_Buddler_Mine()
{
	AI_Output (other, self, "DIA_Arog_Buddler_15_2"); // Erz�hl mir mehr �ber die alte Mine.
	AI_Output (self, other, "DIA_Arog_Buddler_5_10"); // Es ist Beliars Reich hier auf der Erde. Die st�ndige Dunkelheit, das wenige Essen, die Schl�ge der Gardisten, die knochenbrechende Arbeit,...
	AI_Output (self, other, "DIA_Arog_Buddler_5_11"); // Die Schreie... Du kannst es dir nicht vorstellen. Es bleibt nur die Flucht, oder der sichere Tod.
};

Func void DIA_Arog_Buddler_Plan()
{
	AI_Output (other, self, "DIA_Arog_Buddler_15_5"); // Was ist euer Plan? Soll ich den Alchemisten t�ten?
	AI_Output (self, other, "DIA_Arog_Buddler_5_16"); // Nein! Niemand soll wegen uns sterben. Au�erdem w�rde die Garde davon bestimmt schnell Wind bekommen und nach den T�tern suchen.
	AI_Output (self, other, "DIA_Arog_Buddler_5_17"); // Ich wei� nicht, was wir tun sollen. Aber viel Zeit haben wir nicht mehr. Es k�nnte jederzeit jemand aus dem Dorf hier aufkreuzen.
	AI_Output (self, other, "DIA_Arog_Buddler_5_18"); // Vielleicht findest du einen Weg diesen Alchemisten zu �berzeugen.
	
	B_LogEntry (TOPIC_SaveBeppo, "Die Buddler wollen nicht, dass ich den Alchemisten t�te und selbst wollen sie es auch nicht tun. Wenn ich keinen anderen Weg finde, werde ich die Heilung f�r Beppo wohl von seinem toten K�rper nehmen m�ssen.");
};

Func void DIA_Arog_Buddler_Alchemist()
{
	AI_Output (other, self, "DIA_Arog_Buddler_15_3"); // Was wollt ihr vom Alchemisten?
	AI_Output (self, other, "DIA_Arog_Buddler_5_12"); // Wir wollen nur, dass er niemanden verr�t, dass wir hier waren. Wir kennen dieses Land hier nicht.
	AI_Output (self, other, "DIA_Arog_Buddler_5_13"); // Wenn die Gardisten davon erfahren, dass wir aus der Mine entkommen sind, wird es ein leichtes f�r sie sein uns zu finden.
	AI_Output (other, self, "DIA_Arog_Buddler_15_4"); // Glaubst du nicht, dass euch die Gardisten aus der Mine ohnehin schon suchen?
	AI_Output (self, other, "DIA_Arog_Buddler_5_14"); // (lacht bitter) Niemals. Die k�nnen uns Buddler nicht mehr von einander unterscheiden. Vor ein paar Jahren vielleicht noch. Doch die Zeiten haben sich ge�ndert.
	AI_Output (self, other, "DIA_Arog_Buddler_5_15"); // Wir sind so viele geworden. Jeden Tag kommen neue, jeden Tag sterben wir...
	
	Log_CreateTopic (TOPIC_Abgrund, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_Abgrund, LOG_RUNNING);
	B_LogEntry (TOPIC_Abgrund, "Die Buddler kennen sich in der Gegend nicht aus und w�rden von den Gardisten wohl rasch aufgesp�rt werden, wenn sie nicht einen gewissen Vorsprung haben. Noch hat anscheinend niemand Alarm geschlagen, dass sie entkommen sind.");
};
	
Func void DIA_Arog_Buddler_You()
{
	AI_Output (other, self, "DIA_Arog_Buddler_15_6"); // Und wer bist du?
	AI_Output (self, other, "DIA_Arog_Buddler_5_19"); // Ich hei�e Arog. Mein halbes Leben habe ich schon in den Minen auf dieser Insel verbracht. Am Anfang dachte ich noch, sie w�rden uns irgendwann wieder frei lassen.
	AI_Output (self, other, "DIA_Arog_Buddler_5_20"); // Aber ich habe verstanden, dass das nicht passieren wird. Als sie dann eines Tages die Mine abriegelten, gaben die Meisten die Hoffnung auf.
	AI_Output (self, other, "DIA_Arog_Buddler_5_21"); // Ich sage dir, als ich die frische Luft erstmals wieder schmecken konnte, wusste ich, ich werde niemals die Hoffnung aufgeben.
};

Func void DIA_Arog_Buddler_Hugo()
{
	AI_Output (other, self, "DIA_Arog_Buddler_15_1"); //Wer ist Hugo?
	AI_Output (self, other, "DIA_Arog_Buddler_5_8"); // Er war einer von uns. Aber er ist im Wald einfach pl�tzlich in der Dunkelheit verschwunden.
	AI_Output (self, other, "DIA_Arog_Buddler_5_9"); // Wir haben W�lfe heulen h�ren. Seine Schreie waren entsetzlich.
	
	Log_CreateTopic (TOPIC_Hugo, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_Hugo, LOG_RUNNING);
	B_LogEntry (TOPIC_Hugo, "Hugo war ein Freund von Arog und ist irgendwo im Wald am Weg von der alten Mine zur H�tte des Alchemisten verloren gegangen. Wahrscheinlich haben ihn W�lfe erwischt.");
};


// ************************************************************
// 			  	Entscheidung KillAlchemist
// ************************************************************

Instance DIA_Arog_EntscheidungKillAlchemist (C_INFO)
{
	npc 		= SLD_99005_Arog;
	nr 			= 2;
	condition 	= DIA_Arog_EntscheidungKillAlchemist_Condition;
	information = DIA_Arog_EntscheidungKillAlchemist_Info;
	important 	= TRUE;
};

Func int DIA_Arog_EntscheidungKillAlchemist_Condition ()
{
	if (Npc_IsDead (SLD_99004_AlchemistWald)
	&& Npc_KnowsInfo (other, DIA_Arog_Buddler)
	&& !EntscheidungBuddlerMapTaken
	&& !EntscheidungKillBuddlerTaken)
	{
	return TRUE;
	};
};

Func void DIA_Arog_EntscheidungKillAlchemist_Info ()
{
	AI_Output (self, other, "DIA_Arog_EntscheidungKillAlchemist_15_6"); //Du hast ihn einfach umgebracht... Er ist tot. Wir m�ssen sofort hier weg.
	AI_Output (other, self, "DIA_Arog_EntscheidungKillAlchemist_5_6"); //Viel Gl�ck.
	
	EntscheidungKillTaken = TRUE;
	Npc_SetRefuseTalk (self, 1000); 
	AI_StopProcessInfos	(self);

	
	////////////////////////// NPCs fliehen und d�rfen nicht ansprechbar sein
};


// ************************************************************
// 			  	Entscheidung Karte
// ************************************************************

Instance DIA_Arog_EntscheidungKarte (C_INFO)
{
	npc 		= SLD_99005_Arog;
	nr 			= 3;
	condition 	= DIA_Arog_EntscheidungKarte_Condition;
	information = DIA_Arog_EntscheidungKarte_Info;
	description = "Schau her. Ich habe eine Karte vom Tal.";
};

Func int DIA_Arog_EntscheidungKarte_Condition()
{
	if (Npc_HasItems (other,ItWr_Map_OldWorld)
	&& Npc_KnowsInfo (other, DIA_Arog_Buddler)
	&& !EntscheidungKillBuddlerTaken
	&& !(Npc_KnowsInfo(other, DIA_Arog_EntscheidungKillAlchemist))
	&& (Buddler_angekommen == FALSE)
	&& (self.aivar[AIV_PARTYMEMBER] == FALSE))
	{
	return TRUE;
	};
};

Func void DIA_Arog_EntscheidungKarte_Info()
{
	AI_Output (other, self, "DIA_Arog_EntscheidungKarte_15_1"); //Schau her. Ich habe eine Karte vom Tal. Wenn wir diesen Weg gehen, werden sie euch nicht finden. Folgt mir. Ich bringe euch hier raus.
	AI_Output (self, other, "DIA_Arog_EntscheidungKarte_5_3"); //Du hast eine Karte? Nicht schlecht. Ich sch�tze wir haben keine andere M�glichkeit, als dir zu vertrauen.
	AI_Output (self, other, "DIA_Arog_EntscheidungKarte_5_4"); //Los geht's, Freunde. Es ist Zeit zu gehen.
	AI_Output (self, other, "DIA_Arog_EntscheidungKarte_15_2"); //Danke, dass du all das auf dich nimmst. Das werden wir dir niemals vergessen.
	
	EntscheidungBuddlerMapTaken = TRUE;
	
	// if (C_ArogTooFar(0))
	// {
//		AI_Output (self, other, "DIA_Arog_EntscheidungKarte_11_01"); //Das ist die falsche Richtung!
//
//		AI_StopProcessInfos (self);
//	}
//	else
//	{
//		AI_Output (self, other, "DIA_Arog_EntscheidungKarte_11_02"); //Alles klar.

		Npc_ExchangeRoutine	(self,"FOLLOW");
		self.aivar[AIV_PARTYMEMBER] = TRUE;

		SLD_99006_Buddler1.aivar[AIV_PARTYMEMBER] = TRUE;
		B_StartOtherRoutine  (SLD_99006_Buddler1,"FOLLOW");
		SLD_99007_Buddler2.aivar[AIV_PARTYMEMBER] = TRUE;
		B_StartOtherRoutine  (SLD_99007_Buddler2,"FOLLOW");

		AI_StopProcessInfos (self);

		B_LogEntry (TOPIC_Abgrund, "Ich werde Arog und seine Freunde von hier fortf�hren. Die Karte, die ich gefunden habe wird mir dabei helfen. Ich sch�tze wir sollten dem Fluss folgen und in Richtung S�den zu den Wasserf�llen, m�glichst weit weg vom Dorf.");
};


// ************************************************************
// 			  	Arog in Sicherheit
// ************************************************************

Instance DIA_Arog_EntscheidungKarte_Angekommen(C_INFO)
{
	npc			= 	SLD_99005_Arog;
	nr		 	= 	9;
	condition	= 	DIA_Arog_EntscheidungKarte_Angekommen_Condition;
	information	= 	DIA_Arog_EntscheidungKarte_Angekommen_Info;
	description	= 	"Wir sind da.";
};

func int DIA_Arog_EntscheidungKarte_Angekommen_Condition ()
{
	if (Npc_GetDistToWP(self,"WP_AROG_ESCAPE")<800
	&& (Npc_KnowsInfo (other, DIA_Arog_EntscheidungKarte)))
	{
		return TRUE;
	};
};

func void DIA_Arog_EntscheidungKarte_Angekommen_Info ()
{
	AI_Output (other, self, "DIA_Arog_Angekommen_11_02"); //Wir sind da.
	AI_Output (self, other, "DIA_Arog_Angekommen_11_03"); //Wahrhaftig. Ich glaube bis hierher wird uns niemand folgen.
	AI_Output (self, other, "DIA_Arog_Angekommen_11_04"); //Ich danke dir, mein Freund. Du hast uns gerettet.
	AI_Output (self, other, "DIA_Arog_Angekommen_11_05"); //Wir werden uns irgendwo hier in der Gegend verstecken. 
	AI_Output (self, other, "DIA_Arog_Angekommen_11_06"); //Hier, das ist f�r dich. Es ist alles, was ich noch habe.

	CreateInvItems (self, ItMi_Nugget, 3);									
	B_GiveInvItems (self, other, ItMi_Nugget, 3);

	AI_Output (self, other, "DIA_Arog_Angekommen_11_07"); //Vielleicht sehen wir uns ja eines Tages wieder.
	AI_Output (self, other, "DIA_Arog_Angekommen_11_08"); //Ich hoffe es jedenfalls sehr.
	
	AI_StopProcessInfos (self);
	
	self.aivar[AIV_PARTYMEMBER] = FALSE;
	Npc_ExchangeRoutine	(self,"ESCAPE");

	SLD_99006_Buddler1.aivar[AIV_PARTYMEMBER] = FALSE;
	B_StartOtherRoutine  (SLD_99006_Buddler1,"ESCAPE");
	
	SLD_99007_Buddler2.aivar[AIV_PARTYMEMBER] = FALSE;
	B_StartOtherRoutine  (SLD_99007_Buddler2,"ESCAPE");

	B_GivePlayerXP (400);
	Buddler_angekommen = TRUE;

	B_LogEntry (TOPIC_Abgrund, "Ich habe Arog und seine Gef�hrten in Sicherheit gebracht. Sie werden sich irgendwo in der Umgebung verstecken. Er scheint ein aufrichtiger Kerl zu sein.");
};


// ************************************************************
// 			  	Entscheidung KillBuddler
// ************************************************************

Instance DIA_Arog_EntscheidungKillBuddler (C_INFO)
{
	npc 		= SLD_99005_Arog;
	nr 			= 4;
	condition 	= DIA_Arog_EntscheidungKillBuddler_Condition;
	information = DIA_Arog_EntscheidungKillBuddler_Info;
	description = "(angreifen) Ich habe mich entschieden. Eure Reise endet hier.";
};

Func int DIA_Arog_EntscheidungKillBuddler_Condition()

{
	if (!EntscheidungBuddlerMapTaken
	&& Npc_KnowsInfo (other, DIA_Arog_Buddler))
	{
		return TRUE;
	};
};

Func void DIA_Arog_EntscheidungKillBuddler_Info()
{
	AI_Output (other, self, "DIA_Arog_EntscheidungKillBuddler_15_7"); //(angreifen) Ich habe mich entschieden. Eure Reise endet hier.
	AI_Output (self, other, "DIA_Arog_EntscheidungKillBuddler_5_9"); //Wirst du uns etwa verraten?
	AI_Output (other, self, "DIA_Arog_EntscheidungKillBuddler_15_8"); //Nein.
	AI_DrawWeapon (other);
	AI_Wait (self,1);
	AI_PlayAni (self, "T_JUMPB");
	AI_playAni (other, "T_1HATTACKL");
	AI_playAni (other, "T_1HATTACKR");
	AI_Output (self, other, "DIA_Arog_EntscheidungKillBuddler_5_10"); //Was? Nein... bitte nicht!
	AI_PlayAni (self, "T_JUMPB");
	
	
	EntscheidungKillBuddlerTaken = TRUE;
	AI_StopProcessInfos (self);
	B_Attack (self, other, AR_NONE, 1);
	B_SetAttitude (self, ATT_HOSTILE);
	B_SetAttitude (SLD_99006_Buddler1, ATT_HOSTILE);
	AI_WaitTillEnd (SLD_99005_Arog, SLD_99006_Buddler1);
};

// ************************************************************
// 			  	Entscheidung ThreatAlchemist
// ************************************************************

Instance DIA_Arog_EntscheidungThreatAlchemist (C_INFO)
{
	npc 		= SLD_99005_Arog;
	nr 			= 5;
	condition 	= DIA_Arog_EntscheidungThreatAlchemist_Condition;
	information = DIA_Arog_EntscheidungThreatAlchemist_Info;
	description = "Packt eure Sachen. Zeit zu gehen.";
};

Func int DIA_Arog_EntscheidungThreatAlchemist_Condition()
{
	if (Npc_KnowsInfo 	(other, DIA_AlchemistWald_EntscheidungThreat)
	&& Npc_KnowsInfo (other, DIA_Arog_Buddler)
	&& EntscheidungThreatTaken)
	{
	return TRUE;
	};
};

Func void DIA_Arog_EntscheidungThreatAlchemist_Info()
{
	AI_Output (other, self, "DIA_Arog_EntscheidungThreatAlchemist_15_10"); //Packt eure Sachen. Zeit zu gehen.
	AI_Output (self, other, "DIA_Arog_EntscheidungThreatAlchemist_5_12"); //Unsere Sachen? Sehr witzig. Hast du ihn �berzeugen k�nnen?
	AI_Output (other, self, "DIA_Arog_EntscheidungThreatAlchemist_15_11"); //Ja, er ist �berzeugt. Die Geschichte wurde ihm doch ein wenig zu hei�.
	AI_Output (self, other, "DIA_Arog_EntscheidungThreatAlchemist_5_13"); //Was meinst du damit? Egal! Ich glaube dir. Lass uns hier verschwinden.
	AI_Output (self, other, "DIA_Arog_EntscheidungThreatAlchemist_5_14"); //Danke! Das werden wir dir niemals vergessen.
	AI_StopProcessInfos (self);

	Npc_ExchangeRoutine	(self, "ESCAPEALONE");
	B_StartOtherRoutine  (SLD_99007_Buddler2,"ESCAPEALONE");
	B_StartOtherRoutine  (SLD_99006_Buddler1,"ESCAPEALONE");

	B_LogEntry (TOPIC_Abgrund, "Ich habe dem Alchemisten ein wenig Angst eingejagt. Die Buddler k�nnen nun in Ruhe abhauen. Ich glaube kaum, dass er sie verraten wird. Sein bester Freund werde ich aber wahrscheinlich nicht mehr werden.");
};

// ************************************************************
// 			  	Entscheidung Vergessenheitstrank
// ************************************************************

Instance DIA_Arog_EntscheidungVergessenheitstrank (C_INFO)
{
	npc 		= SLD_99005_Arog;
	nr 			= 6;
	condition 	= DIA_Arog_EntscheidungVergessenheitstrank_Condition;
	information = DIA_Arog_EntscheidungVergessenheitstrank_Info;
	description = "Packt eure Sachen. Zeit zu gehen.";
};

Func int DIA_Arog_EntscheidungVergessenheitstrank_Condition()
{
	if (Npc_KnowsInfo 	(other, DIA_AlchemistWald_Amnesie)
	&& Npc_KnowsInfo (other, DIA_Arog_Buddler)
	&& !EntscheidungBuddlerMapTaken
	&& EntscheidungVergessenTaken)
	{	
		return TRUE;
	};
};

Func void DIA_Arog_EntscheidungVergessenheitstrank_Info()
{
	AI_Output (other, self, "DIA_Arog_EntscheidungVergessenheitstrank_15_14"); //Packt eure Sachen. Zeit zu gehen.
	AI_Output (self, other, "DIA_Arog_EntscheidungVergessenheitstrank_5_16"); //Unsere Sachen? Sehr witzig. Hast du ihn �berzeugen k�nnen?
	AI_Output (other, self, "DIA_Arog_EntscheidungVergessenheitstrank_15_15"); //Sagen wir er wird es schwer haben, jemanden von euch zu erz�hlen.
	AI_Output (self, other, "DIA_Arog_EntscheidungVergessenheitstrank_5_17"); //Was meinst du damit? Egal. Ich glaube dir. Lass uns hier wegkommen.
	AI_Output (self, other, "DIA_Arog_EntscheidungVergessenheitstrank_5_18"); //Danke! Das werden wir dir niemals vergessen.
	AI_StopProcessInfos (self);

	Npc_ExchangeRoutine	(self, "Escape");
	B_StartOtherRoutine  (SLD_99007_Buddler2,"ESCAPE");
	B_StartOtherRoutine  (SLD_99006_Buddler1,"ESCAPE");

	B_LogEntry (TOPIC_Abgrund, "Der Alchemist schl�ft nun. Die Buddler k�nnen also abhauen und werden einen guten Vorsprung haben. Wenn sie sich nicht allzu dumm anstellen, werden sie vermutlich entkommen.");
};