-- Individual events (max team size 1) register without a team name.
ALTER TABLE "Registration" ALTER COLUMN "teamName" DROP NOT NULL;
