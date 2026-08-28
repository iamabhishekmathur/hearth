resource "aws_lb" "api" {
  name               = "${var.project}-api"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id, aws_security_group.alb_https.id]
  subnets            = var.subnet_ids

  idle_timeout = 300 # keep WebSocket (Socket.io /ws) connections alive
}

resource "aws_lb_target_group" "api" {
  name        = "${var.project}-api"
  port        = 8000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/api/v1/health"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Give in-flight WebSocket/HTTP requests time to drain on redeploy.
  deregistration_delay = 30
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}
