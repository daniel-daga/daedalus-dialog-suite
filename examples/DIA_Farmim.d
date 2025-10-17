// ************************************************************
// 			  				FIRST EXIT 
// ************************************************************

INSTANCE DIA_99003_Farim (C_INFO)
{
	npc			= SLD_99003_Farim;
	nr			= 999;
	condition	= DIA_Farim_FirstEXIT_Condition;
	information	= DIA_Farim_FirstEXIT_Info;
	permanent	= FALSE;
	description = "Dann werde ich mich jetzt auf den Weg machen! (ENDE)";
};
                       
FUNC INT DIA_Farim_FirstEXIT_Condition()
{
	if (Npc_KnowsInfo (other, DIA_Farim_Hallo))
	{
		return TRUE
	};
};

FUNC VOID DIA_Farim_FirstEXIT_Info()
{	
	AI_Output (other, self,"DIA_Farim_FirstEXIT_15_00"); //Danke f�r deine Hilfe. Dann werde ich mich jetzt auf den Weg machen!
	AI_Output (self, other,"DIA_Farim_FirstEXIT_14_01"); //Gut! Und eines noch: Wenn du Beppo geheilt hast, komm zu mir zur�ck.
	B_LogEntry 	(TOPIC_SaveBeppo, "Farim will, dass ich zu ihm zur�ck kehre, sobald ich Heilung f�r Beppo gefunden habe. Ich sch�tze er sorgt sich auch um ihn.");
		
	AI_StopProcessInfos	(self);
	
	B_Kapitelwechsel (1, NEWWORLD_ZEN);	//Joly: mu� auf jeden Fall hier kommen. Allein schon wegen XP_AMBIENT! 							//// Welt angeben?
	
	Npc_ExchangeRoutine (self,"START");
};


///////////////////////////////////////////////////////////////////////
//	Info EXIT 
///////////////////////////////////////////////////////////////////////
INSTANCE DIA_Farim_EXIT   (C_INFO)
{
	npc         = SLD_99003_Farim;
	nr          = 999;
	condition   = DIA_SLD_Farim_EXIT_Condition;
	information = DIA_SLD_Farim_EXIT_Info;
	permanent   = TRUE;
	description = DIALOG_ENDE;
};

FUNC INT DIA_SLD_Farim_EXIT_Condition()
{
	return TRUE;
};

FUNC VOID DIA_SLD_Farim_EXIT_Info()
{
	AI_StopProcessInfos (self);
};

// ************************************************************
// 			  	HalloFarim
// ************************************************************

Instance DIA_Farim_Hallo (C_INFO)
{
	npc 		= SLD_99003_Farim;
	nr 			= 1;
	condition 	= DIA_Farim_Hallo_Condition;
	information = DIA_Farim_Hallo_Info;
	Permanent 	=  FALSE;
	description = "Hallo, kannst du mir helfen?";
};

Func int DIA_Farim_Hallo_Condition()
{
	return TRUE;
};

Func void DIA_Farim_Hallo_Info()
{
	AI_Output (other, self, "DIA_Farim_Hallo_15_0");//Hallo, kannst du mir helfen?
	AI_Output (self, other, "DIA_Farim_Hallo_14_2");//Du siehst wahrlich aus, als k�nntest du Hilfe gebrauchen. Wer bist du?
	Log_CreateTopic (Topic_Trader_Out, LOG_NOTE);
	B_LogEntry (Topic_Trader_Out, "Farim der Fischer vorm Dorf im Minental ist hilfreich mit Informationen und scheint auch sonst ein netter Zeitgenosse zu sein.");
	
	Info_ClearChoices	(DIA_Farim_Hallo);
	Info_AddChoice	(DIA_Farim_Hallo, "Ich habe nichts. Es ist Innos Wille, dass den Bed�rftigen geholfen wird.", DIA_Farim_Hallo_Innos);
	Info_AddChoice	(DIA_Farim_Hallo, "Ich bin auf der Flucht. Ich bin hierher gekommen, um ein neues Leben zu beginnen.", DIA_Farim_Hallo_Wahrheit);
};

func void DIA_Farim_Hallo_Wahrheit ()
{
	AI_Output 	(other, self, "DIA_Farim_Wahrheit_08_00");//Ich bin auf der Flucht und bin hierher gekommen, um ein neues Leben zu beginnen.
	
	Log_CreateTopic (TOPIC_NewLife, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_NewLife, LOG_RUNNING);
	B_LogEntry (TOPIC_NewLife, "Ich habe es ins Minental geschafft. Um ein Haar w�re ich umgekommen, aber hier sollte ich vor der Diebesgilde sicher sein. Ich habe 
	nichts. Ich muss versuchen mir hier etwas aufzubauen. Doch wo soll ich anfangen?");
	
	AI_Output 	(self, other, "DIA_Farim_Wahrheit_15_00");//Soso. Auf der Flucht sagst du? Und vor wem fl�chtest du? Vor der k�niglichen Garde?
	AI_Output 	(other, self, "DIA_Farim_Wahrheit_08_01");//Nein, ich komme aus Khorinis. Ich musste die Stadt verlassen. Die Diebesgilde will mich tot sehen.
	AI_Output 	(self, other, "DIA_Farim_Wahrheit_15_01");//Die Diebesgilde sagst du? Als ich das letzte Mal in der Stadt war, haben mir die Dreckskerle die H�tte aufgebrochen.
	
	Log_CreateTopic (TOPIC_Diebesgilde, LOG_NOTE);
	Log_SetTopicStatus (TOPIC_Diebesgilde, LOG_RUNNING);
	B_LogEntry (Topic_Diebesgilde,"Die Diebesgilde, die gef�hrlichste Untergrundorganisation in der Stadt Khorinis, will mich tot sehen. Ich habe zuf�llig ihren Unterschlupf entdeckt und sie haben mich dabei gesehen. Ich bin eine Gefahr f�r sie, solange ich lebe. Der Fischer Farim scheint auch schon von ihnen bestohlen worden zu sein.");
	
	AI_Output 	(self, other, "DIA_Farim_Wahrheit_15_02");//Erwischt hat die Stadtwache nat�rlich niemanden.
	AI_Output 	(self, other, "DIA_Farim_Wahrheit_15_03");//Nagut. Ich glaube dir f�r's Erste. Und was willst du von mir?
	
	Info_ClearChoices	(DIA_Farim_Hallo);
	Info_AddChoice	(DIA_Farim_Hallo, "Mein Freund ist verletzt. Wenn wir nichts tun, wird er sterben.", DIA_Farim_Hallo_Verletzung);
};

func void DIA_Farim_Hallo_Innos ()
{	AI_Output 	(other, self, "DIA_Farim_Hallo_Innos_08_00");//Ich habe nichts. Es ist Innos Wille, dass den Bed�rftigen geholfen wird.
	AI_Output 	(self, other, "DIA_Farim_Hallo_Innos_15_00");//(lacht) Innos also. Und woher wei� ich, dass du mir bei der ersten Gelegenheit nicht die Kehle durchschneiden wirst? 
	AI_Output 	(self, other, "DIA_Farim_Hallo_Innos_15_01");//Was mich betrifft k�nntest du einer dieser entlaufenen Gefangenen sein.
	AI_Output 	(self, other, "DIA_Farim_Hallo_Innos_15_02");//(misstrauisch) Wo kommst du eigentlich her? Aus der Mine? Du solltest aufpassen, was du als n�chstes sagst.
	
	Info_ClearChoices	(DIA_Farim_Hallo);
	Info_AddChoice	(DIA_Farim_Hallo, "�hm... Gib mir all deine Fische.", DIA_Farim_Hallo_Tot );
	Info_AddChoice	(DIA_Farim_Hallo, "Ich komme aus der Stadt. Mein Freund ist verletzt. Wenn wir nichts tun, wird er sterben.", DIA_Farim_Hallo_Verletzung );
};

func void DIA_Farim_Hallo_Tot ()
{
	AI_Output 	(other, self, "DIA_Farim_Hallo_Tot_08_01");//Gib mir all deine Fische.
	AI_Output 	(self, other, "DIA_Farim_Hallo_Tot_08_00");//(b�se) Hab ich's doch gewusst. Noch so ein Mistkerl.
	
	AI_StopProcessInfos (self);
	B_Attack (self, other, AR_NONE,1);
	B_SetAttitude (self, ATT_HOSTILE);
};

func void DIA_Farim_Hallo_Verletzung ()
{
	AI_Output 	(other, self, "DIA_Farim_Hallo_Verletzung_08_00");//Mein Freund ist verletzt. Wenn wir nichts tun, wird er sterben.
	AI_Output 	(self, other, "DIA_Farim_Hallo_Verletzung_08_01");//Wer ist dein Freund? Was ist passiert?
	AI_Output 	(other, self, "DIA_Farim_Hallo_Verletzung_14_00");//Sein Name ist Beppo und er wohnt gleich hier oben auf dem kleinen Plateau. Ein besoffener Gardist hat auf ihn geschossen.
	AI_Output 	(self, other, "DIA_Farim_Hallo_Verletzung_08_02");//Ich kenne Beppo. Ich kann dir aber kaum helfen. Einen magischen Heiltrank habe ich leider nicht. Die sind verdammt teuer.
	AI_Output 	(self, other, "DIA_Farim_Hallo_Verletzung_08_03");//Ich kann dir h�chstens diese Waldbeeren geben, die hier �berall wachsen. Sie haben auch eine gewisse Heilkraft.
	
	CreateInvItems (self, ItPl_Forestberry, 5);									
	B_GiveInvItems (self, other, ItPl_Forestberry, 5);
	
	AI_Output 	(self, other, "DIA_Farim_Hallo_Verletzung_08_04");//Nimm au�erdem diese gebratenen Fische. Ich bef�rchte mehr kann ich nicht f�r euch tun.
	
	CreateInvItems (self, ItFo_Fish, 4);									
	B_GiveInvItems (self, other, ItFo_Fish, 4);
	
	AI_Output 	(self, other, "DIA_Farim_Hallo_Verletzung_08_05");//Wenn du aber einen Heiltrank brauchst, solltest du zum Alchemisten im Wald gehen, oder es im Dorf versuchen.
	
	Log_CreateTopic (TOPIC_SaveBeppo, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_SaveBeppo, LOG_RUNNING);
	B_LogEntry (TOPIC_SaveBeppo, "Farim kennt Beppo. Mit Heilung konnte er mir nicht helfen, aber er hat mir Essen mitgegeben. Besser als nichts. Das sollte Beppo zumindest vorerst st�rken. Ich sollte sofort zu ihm zur�ck gehen.");
	B_LogEntry (TOPIC_SaveBeppo, "Was einen echten magischen Heiltrank betrifft, erw�hnte Farim einen Alchemisten der hier in der Gegend wohnt. Vielleicht kann er mir helfen.");

	Info_ClearChoices	(DIA_Farim_Hallo);
	Info_AddChoice		(DIA_Farim_Hallo, "Wie komme ich am schnellsten ins Dorf?", DIA_Farim_Hallo_Dorf);
	Info_AddChoice		(DIA_Farim_Hallo, "Wo finde ich diesen Alchemisten?", DIA_Farim_Hallo_Alchemist);
};

func void DIA_Farim_Hallo_Dorf ()
{
	AI_Output 	(other, self, "DIA_Farim_Hallo_Dorf_14_00");//Wie komme ich am schnellsten ins Dorf?
	AI_Output 	(self, other, "DIA_Farim_Hallo_Dorf_08_00");//So abgerissen wie du aussiehst werden dich die Wachen nicht vorbei lassen.
	AI_Output 	(self, other, "DIA_Farim_Hallo_Dorf_08_01");//Die werden glauben, dass du aus der Mine abgehaut bist. Das w�re GERADE JETZT nicht gut f�r dich.
	AI_Output 	(other, self, "DIA_Farim_Hallo_Dorf_14_01");//Wieso "gerade jetzt"?

	AI_Output 	(self, other, "DIA_Farim_Hallo_Dorf_08_03");//Erst k�rzlich haben es einige von den Kerlen geschafft aus der alten Mine zu entkommen. Wahrscheinlich treiben, sie sich hier noch in der Gegend rum. Seitdem nehme ich immer diese Armbrust mit zum Fischen.
	
	Log_CreateTopic (TOPIC_Abgrund, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_Abgrund, LOG_RUNNING);
	B_LogEntry (TOPIC_Abgrund, "Farim erz�hlte mir, dass k�rzlich Buddler aus der alten Mine entkommen sind. Entlaufene Gefangene, die nichts zu verlieren haben... das k�nnte gef�hrlich werden. Ich sollte hier gut auf mich aufpassen.");
	
	AI_Output 	(self, other, "DIA_Farim_Hallo_Dorf_08_04");//Fest steht jedenfalls, dass du andere Kleidung brauchen wirst. Davor solltest du dich bei den k�niglichen Gardisten besser nicht blicken lassen, wenn dir dein Leben lieb ist.
	
	Log_CreateTopic (TOPIC_ZugangDorf, LOG_MISSION);
	Log_SetTopicStatus (TOPIC_ZugangDorf, LOG_RUNNING);
	B_LogEntry 	(TOPIC_ZugangDorf, "Das Dorf um die Burg. Um hinein zu kommen brauche ich ordentliche Kleidung. Wo soll ich die nur herbekommen?");

	Info_ClearChoices	(DIA_Farim_Hallo);
	Info_AddChoice		(DIA_Farim_Hallo, "K�nntest DU mir nicht einen Heiltrank aus dem Dorf besorgen?", DIA_Farim_Hallo_KleidungHolen );
	Info_AddChoice		(DIA_Farim_Hallo, "Gibt es keinen anderen Weg ins Dorf?", DIA_Farim_Hallo_KleidungSchleichen );
};

func void DIA_Farim_Hallo_KleidungHolen ()
{	
	AI_Output 	(other, self, "DIA_Farim_Hallo_KleidungHolen_14_00");//K�nntest DU mir nicht einen Heiltrank, oder passende Kleidung aus dem Dorf besorgen?
	AI_Output 	(self, other, "DIA_Farim_Hallo_KleidungHolen_08_00");//Ich bin nur Fischer. Ich lebe von einem Tag in den anderen. Also wenn du nicht zuf�llig einen Haufen Gold dabei hast, kann ich dir nicht helfen.
};	

func void DIA_Farim_Hallo_KleidungSchleichen ()
{
	AI_Output 	(other, self, "DIA_Farim_Hallo_KleidungSchleichen_14_00");//Gibt es keinen anderen Weg ins Dorf? Bei dem die Wachen mich nicht aufhalten werden?
	AI_Output 	(self, other, "DIA_Farim_Hallo_KleidungSchleichen_08_00");//Ich kenne keinen. Das hei�t aber nicht, dass es unm�glich ist. Versuchen kannst du es. Sei aber lieber vorsichtig.
	B_LogEntry 	(TOPIC_ZugangDorf, "Farim sagt, es k�nnte auch einen anderen Weg ins Dorf geben. Ich k�nnte nach einem suchen...");
};

func void DIA_Farim_Hallo_Alchemist ()
{
	AI_Output 	(other, self, "DIA_Farim_Hallo_Alchemist_14_00");//Wo kann ich diesen Alchemisten finden?
	AI_Output 	(self, other, "DIA_Farim_Hallo_Alchemist_08_00");//Der lebt ganz hier in der N�he, im Wald. Wenn er nicht gerade bei seiner H�tte ist, streift er meistens dort herum und sucht irgendwelche Kr�uter.
	B_LogEntry 	(TOPIC_SaveBeppo, "Der Alchemist wohnt gleich s�dlich von Farims Angelplatz im Wald. Da es schwer f�r mich wird ins Dorf zu kommen, k�nnte ich auch als erstes dort hin gehen. Wer wei�, vielleicht ist er ja nett und hilft mir.");
};