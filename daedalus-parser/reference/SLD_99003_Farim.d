
instance SLD_99003_Farim (Npc_Default)
{
	// ------ NSC ------
	name 		= "Farim";
	guild 		= GIL_SLD;
	id 			= 99003;
	voice 		= 11;
	flags       = NPC_FLAG_IMMORTAL;		//NPC_FLAG_IMMORTAL oder 0
	npctype		= NPCTYPE_MAIN;
	
	level = 100;
	
	attribute[ATR_STRENGTH] 		= 50;
	attribute[ATR_DEXTERITY] 		= 50;
	attribute[ATR_MANA_MAX] 		= 100;
	attribute[ATR_MANA] 			= 100;
	attribute[ATR_HITPOINTS_MAX]	= 150;
	attribute[ATR_HITPOINTS] 		= 150;

	
	// ------ Attribute ------
	B_SetAttributesToChapter (self, 1);																	//setzt Attribute und LEVEL entsprechend dem angegebenen Kapitel (1-6)
	
	// ------ Kampf-Taktik ------
	fight_tactic		= FAI_HUMAN_COWARD;	// MASTER / STRONG / COWARD
	
	// ------ Equippte Waffen ------																	//Munition wird automatisch generiert, darf aber angegeben werden
	EquipItem			(self, ItRw_Crossbow_L_02);
	
	// ------ Inventory ------
	B_CreateAmbientInv 	(self);
		
	// ------ visuals ------																			//Muss NACH Attributen kommen, weil in B_SetNpcVisual die Breite abh. v. STR skaliert wird
	B_SetNpcVisual 		(self, MALE, "Hum_Head_Fighter", Face_N_NormalBart08, BodyTex_N, ITAR_Bau_L );	
	Mdl_SetModelFatness	(self, 2);
	Mdl_ApplyOverlayMds	(self, "Humans_Relaxed.mds"); // Tired / Militia / Mage / Arrogance / Relaxed

	// ------ NSC-relevante Talente vergeben ------
	B_GiveNpcTalents (self);
	
	// ------ Kampf-Talente ------																		//Der enthaltene B_AddFightSkill setzt Talent-Ani abhängig von TrefferChance% - alle Kampftalente werden gleichhoch gesetzt
	B_SetFightSkills (self, 60); //Grenzen für Talent-Level liegen bei 30 und 60i

	// ------ TA anmelden ------
	daily_routine	= Rtn_Start_99003;
};

FUNC VOID Rtn_Start_99003 ()
{	
		TA_Sit_Chair   	(06,00,24,00,"WP_FARIM_01_SIT");
		TA_Sit_Chair   	(24,00,06,00,"WP_FARIM_01_SIT");
};
