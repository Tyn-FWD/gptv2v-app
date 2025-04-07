build:
	docker build -t gpt-v2v .

dev:
	docker compose -f docker-compose.dev.yaml up

serve:
	docker compose -f docker-compose.prod.yaml down
	docker compose -f docker-compose.prod.yaml up -d
	docker logs gptv2v-app-frontend-1 -f
