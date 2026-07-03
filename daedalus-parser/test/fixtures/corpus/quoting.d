func void B_QuotingCases()
{
	Npc_ExchangeRoutine (self, Routine_Var);
	AI_PlayAni (self, "T_STAND_2_SIT");
	Log_CreateTopic ("My Topic", LOG_MISSION);
	B_LogEntry (TOPIC_Foo, TextConstant);
	Wld_InsertNpc (Grunt, "WP_INTRO");
};
